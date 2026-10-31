import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import XLSX from "xlsx";
import { prisma } from "./db.js";
import { authenticate, requireAdmin } from "./middleware/auth.js";
import { audit } from "./utils/audit.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./private-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve("./public")));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(application\/pdf|image\/(jpeg|png|webp)|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|application\/msword|application\/vnd\.ms-excel)$/;
    cb(null, allowed.test(file.mimetype));
  }
});

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "12h" });
}
function cleanUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}
function parseDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  return date;
}
function managerStoreFilter(user, requestedStoreId) {
  if (user.role === "SUPER_ADMIN") return requestedStoreId || undefined;
  return user.storeId || "__no_store__";
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "Paper Work API" }));

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid login credentials" });
  }
  res.json({ token: signToken(user), user: cleanUser(user) });
});

app.use("/api", authenticate);
app.get("/api/auth/me", (req, res) => res.json({ user: req.user }));

// Stores
app.get("/api/stores", async (req, res) => {
  const where = req.user.role === "SUPER_ADMIN" ? {} : { id: req.user.storeId || "__none__" };
  const stores = await prisma.store.findMany({
    where,
    include: { _count: { select: { managers: true, documents: true } } },
    orderBy: { name: "asc" }
  });
  res.json(stores);
});
app.post("/api/stores", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const code = String(body.code || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  const city = body.city ? String(body.city).trim() : null;
  const address = body.address ? String(body.address).trim() : null;
  if (!code || !name) return res.status(400).json({ error: "Store code and name are required" });
  try {
    const store = await prisma.store.create({ data: { code, name, address, city } });
    await audit({ actorId: req.user.id, action: "CREATE", entityType: "Store", entityId: store.id, after: store });
    res.status(201).json(store);
  } catch (error) {
    if (error?.code === "P2002") return res.status(409).json({ error: "That store code is already in use. Choose a unique code." });
    throw error;
  }
});
app.patch("/api/stores/:id", requireAdmin, async (req, res) => {
  const before = await prisma.store.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Store not found" });
  const body = req.body || {};
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.code !== undefined) data.code = String(body.code).trim().toUpperCase();
  if (body.city !== undefined) data.city = String(body.city).trim() || null;
  if (body.address !== undefined) data.address = String(body.address).trim() || null;
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return res.status(400).json({ error: "Store status must be active or inactive" });
    data.active = body.active;
  }
  if (data.name !== undefined && !data.name) return res.status(400).json({ error: "Store name cannot be empty" });
  if (data.code !== undefined && !data.code) return res.status(400).json({ error: "Store code cannot be empty" });
  try {
    const store = await prisma.store.update({ where: { id: before.id }, data });
    await audit({ actorId: req.user.id, action: "UPDATE", entityType: "Store", entityId: store.id, before, after: store });
    res.json(store);
  } catch (error) {
    if (error?.code === "P2002") return res.status(409).json({ error: "That store code is already in use. Choose a unique code." });
    throw error;
  }
});

// Users: only Super Admin can create or manage accounts
app.get("/api/users", requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({ include: { store: true }, orderBy: { createdAt: "desc" } });
  res.json(users.map(cleanUser));
});
app.post("/api/users", requireAdmin, async (req, res) => {
  const { name, email, password, role = "STORE_MANAGER", storeId } = req.body || {};
  if (!name || !email || !password || password.length < 10) {
    return res.status(400).json({ error: "Name, email and a password of at least 10 characters are required" });
  }
  if (!["SUPER_ADMIN", "STORE_MANAGER"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (role === "STORE_MANAGER" && !storeId) return res.status(400).json({ error: "Store manager must be assigned to a store" });
  const user = await prisma.user.create({
    data: { name, email: email.toLowerCase().trim(), passwordHash: await bcrypt.hash(password, 12), role, storeId: role === "STORE_MANAGER" ? storeId : null }
  });
  await audit({ actorId: req.user.id, action: "CREATE", entityType: "User", entityId: user.id, after: cleanUser(user) });
  res.status(201).json(cleanUser(user));
});
app.patch("/api/users/:id", requireAdmin, async (req, res) => {
  const before = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "User not found" });
  const { password, ...updates } = req.body || {};
  if (updates.role && !["SUPER_ADMIN", "STORE_MANAGER"].includes(updates.role)) return res.status(400).json({ error: "Invalid role" });
  if (password) updates.passwordHash = await bcrypt.hash(password, 12);
  if (updates.email) updates.email = updates.email.toLowerCase().trim();
  const user = await prisma.user.update({ where: { id: before.id }, data: updates });
  await audit({ actorId: req.user.id, action: "UPDATE", entityType: "User", entityId: user.id, before: cleanUser(before), after: cleanUser(user) });
  res.json(cleanUser(user));
});

// Documents and archive
app.get("/api/documents", async (req, res) => {
  const { storeId, category, status, financialYear, referenceNumber, from, to } = req.query;
  const effectiveStore = managerStoreFilter(req.user, storeId);
  const where = {
    ...(effectiveStore ? { storeId: effectiveStore } : {}),
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
    ...(financialYear ? { financialYear: String(financialYear) } : {}),
    ...(referenceNumber ? { referenceNumber: { contains: String(referenceNumber), mode: "insensitive" } } : {}),
    ...(from || to ? { documentDate: { ...(from ? { gte: parseDate(from) } : {}), ...(to ? { lte: parseDate(to) } : {}) } } : {})
  };
  const docs = await prisma.documentRecord.findMany({
    where, include: { store: true, uploadedBy: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" }
  });
  res.json(docs);
});

app.post("/api/documents", upload.single("file"), async (req, res) => {
  try {
    const body = req.body || {};
    const storeId = req.user.role === "SUPER_ADMIN" ? body.storeId : req.user.storeId;
    if (!storeId) return res.status(400).json({ error: "A store must be selected/assigned" });
    if (req.user.role !== "SUPER_ADMIN" && body.storeId && body.storeId !== req.user.storeId) {
      return res.status(403).json({ error: "You can only upload to your assigned store" });
    }
    if (!body.title || !body.category) return res.status(400).json({ error: "Title and category are required" });
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return res.status(404).json({ error: "Store not found" });
    const doc = await prisma.documentRecord.create({
      data: {
        storeId, title: body.title, category: body.category,
        documentDate: parseDate(body.documentDate),
        financialYear: body.financialYear || null,
        referenceNumber: body.referenceNumber || null,
        amount: body.amount === "" || body.amount == null ? null : Number(body.amount),
        currency: body.currency || "INR", notes: body.notes || null,
        uploadedById: req.user.id,
        ...(req.file ? { originalName: req.file.originalname, storedName: req.file.filename, mimeType: req.file.mimetype, fileSize: req.file.size } : {})
      }
    });
    await audit({ actorId: req.user.id, action: "CREATE", entityType: "DocumentRecord", entityId: doc.id, documentId: doc.id, after: doc });
    res.status(201).json(doc);
  } catch (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: error.message || "Could not create document" });
  }
});

// Admin can edit all fields. Managers can edit their own store's draft/correction-requested records.
app.patch("/api/documents/:id", async (req, res) => {
  const before = await prisma.documentRecord.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Document not found" });
  const admin = req.user.role === "SUPER_ADMIN";
  if (!admin && (before.storeId !== req.user.storeId || !["DRAFT", "CORRECTION_REQUESTED"].includes(before.status))) {
    return res.status(403).json({ error: "You cannot edit this document" });
  }
  const allowed = ["storeId", "category", "title", "documentDate", "financialYear", "referenceNumber", "amount", "currency", "notes", "status"];
  const data = {};
  for (const key of allowed) if (Object.hasOwn(req.body || {}, key)) data[key] = req.body[key];
  if (data.documentDate) data.documentDate = parseDate(data.documentDate);
  if (data.amount !== undefined && data.amount !== null && data.amount !== "") data.amount = Number(data.amount);
  if (data.amount === "") data.amount = null;
  const doc = await prisma.documentRecord.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } });
  await audit({ actorId: req.user.id, action: "UPDATE", entityType: "DocumentRecord", entityId: doc.id, documentId: doc.id, before, after: doc });
  res.json(doc);
});

app.post("/api/documents/:id/submit", async (req, res) => {
  const doc = await prisma.documentRecord.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (req.user.role !== "SUPER_ADMIN" && doc.storeId !== req.user.storeId) return res.status(403).json({ error: "Access denied" });
  if (!["DRAFT", "CORRECTION_REQUESTED"].includes(doc.status)) return res.status(400).json({ error: "Only draft or corrected records can be submitted" });
  const updated = await prisma.documentRecord.update({ where: { id: doc.id }, data: { status: "SUBMITTED" } });
  await audit({ actorId: req.user.id, action: "SUBMIT", entityType: "DocumentRecord", entityId: doc.id, documentId: doc.id, before: doc, after: updated });
  res.json(updated);
});

app.post("/api/documents/:id/review", requireAdmin, async (req, res) => {
  const { decision, comment } = req.body || {};
  if (!["APPROVED", "REJECTED", "CORRECTION_REQUESTED"].includes(decision)) return res.status(400).json({ error: "Invalid review decision" });
  const before = await prisma.documentRecord.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Document not found" });
  const updated = await prisma.documentRecord.update({
    where: { id: before.id },
    data: { status: decision, reviewedById: req.user.id, reviewedAt: new Date(), rejectionReason: decision === "REJECTED" ? (comment || null) : null }
  });
  await prisma.approvalLog.create({ data: { documentId: before.id, actorId: req.user.id, decision, comment } });
  await audit({ actorId: req.user.id, action: "REVIEW", entityType: "DocumentRecord", entityId: before.id, documentId: before.id, before, after: updated });
  res.json(updated);
});

// Admin-only file retrieval; original uploads are never exposed as a public static directory.
app.get("/api/documents/:id/file", async (req, res) => {
  const doc = await prisma.documentRecord.findUnique({ where: { id: req.params.id } });
  if (!doc || !doc.storedName) return res.status(404).json({ error: "File not found" });
  if (req.user.role !== "SUPER_ADMIN" && doc.storeId !== req.user.storeId) return res.status(403).json({ error: "Access denied" });
  const filePath = path.join(uploadDir, path.basename(doc.storedName));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Stored file is missing" });
  res.download(filePath, doc.originalName || "document");
});

app.get("/api/audit", requireAdmin, async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    ...(req.query.documentId ? { where: { documentId: String(req.query.documentId) } } : {}),
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" }, take: Math.min(Number(req.query.limit) || 200, 1000)
  });
  res.json(logs);
});

// Excel export. Only approved records appear unless includePending=true is explicitly requested by admin.
app.get("/api/exports/documents.xlsx", async (req, res) => {
  const requestedStore = req.query.storeId ? String(req.query.storeId) : undefined;
  const effectiveStore = managerStoreFilter(req.user, requestedStore);
  if (req.user.role !== "SUPER_ADMIN" && requestedStore && requestedStore !== req.user.storeId) {
    return res.status(403).json({ error: "Access denied" });
  }
  const includePending = req.user.role === "SUPER_ADMIN" && req.query.includePending === "true";
  const where = {
    ...(effectiveStore ? { storeId: effectiveStore } : {}),
    ...(includePending ? {} : { status: "APPROVED" }),
    ...(req.query.financialYear ? { financialYear: String(req.query.financialYear) } : {}),
    ...(req.query.category ? { category: String(req.query.category) } : {})
  };
  const docs = await prisma.documentRecord.findMany({ where, include: { store: true }, orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }] });
  const rows = docs.map(d => ({
    Store: d.store.name, StoreCode: d.store.code, Title: d.title, Category: d.category,
    DocumentDate: d.documentDate?.toISOString().slice(0, 10) || "",
    FinancialYear: d.financialYear || "", ReferenceNumber: d.referenceNumber || "",
    Amount: d.amount ?? "", Currency: d.currency, Status: d.status, Notes: d.notes || "",
    UploadedAt: d.createdAt.toISOString()
  }));
  const wb = XLSX.utils.book_new();
  const summary = [
    ["Paper Work - Store Records Export"],
    ["Generated", new Date().toISOString()],
    ["Records", rows.length],
    ["Approved records only", includePending ? "No (admin requested all statuses)" : "Yes"]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
  const allSheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, allSheet, "Documents");
  const byCategory = new Map();
  for (const row of rows) {
    if (!byCategory.has(row.Category)) byCategory.set(row.Category, []);
    byCategory.get(row.Category).push(row);
  }
  for (const [category, categoryRows] of byCategory) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryRows), category.slice(0, 31));
  }
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `paper-work-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
app.get("/", (req, res) => {
  res.sendFile(path.resolve("./public/index.html"));
});
const server = app.listen(port, () => console.log(`Paper Work API running at http://localhost:${port}`));
async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
