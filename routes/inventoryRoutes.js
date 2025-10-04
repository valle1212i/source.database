// routes/inventoryRoutes.js
const express = require('express');
const EventEmitter = require('events');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');
const InventoryItem = require('../models/InventoryItem');
const InventoryMovement = require('../models/InventoryMovement');

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router();

// === Bilduppladdning (inventarie) ===
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname((file.originalname || '')).toLowerCase();
    const name = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});

const allowedMimes = new Set([
  'image/png','image/jpeg','image/webp','image/gif','image/jfif','image/heic','image/heif'
]);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = file?.mimetype && allowedMimes.has(file.mimetype.toLowerCase());
    cb(ok ? null : new Error('Ogiltig filtyp. Endast bilder tillåtna.'), ok);
  }
});


// Process-lokal eventbus för SSE
const bus = new EventEmitter();
bus.setMaxListeners(100);

function flattenItem(item) {
  const base = {
    id: String(item._id),
    name: item.name,
    description: item.description || '',
    imageUrl: item.imageUrl || '',
    isActive: !!item.isActive
  };
  if (!item.variants || item.variants.length === 0) {
    return [{ ...base, sku: item.sku || '', stock: item.stock || 0, variantKey: null }];
  }
  return item.variants.map(v => ({
    ...base, sku: v.sku || '', stock: v.stock || 0, variantKey: v.key || null
  }));
}

// Snapshot till tabellen
router.get('/api/inventory', requireAuth, requireTenant, async (req, res) => {
  const items = await InventoryItem.find({ tenant: req.tenant, isActive: true }).lean();
  res.json({ success: true, items: items.flatMap(flattenItem) });
});

// SSE-ström (snapshot + uppdateringar)
router.get('/api/inventory/stream', requireAuth, requireTenant, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.flushHeaders?.();

  const tenant = req.tenant;

  (async () => {
    const items = await InventoryItem.find({ tenant, isActive: true }).lean();
    res.write(`data: ${JSON.stringify({ type: 'snapshot', items: items.flatMap(flattenItem) })}\n\n`);
  })();

  const onStock = (payload) => {
    if (payload.tenant !== tenant) return;
    res.write(`data: ${JSON.stringify({ type: 'stock', item: payload.item })}\n\n`);
  };
  bus.on('stock', onStock);
  req.on('close', () => bus.off('stock', onStock));
});

// Skapa produkt (med eller utan varianter)
router.post('/api/inventory/items', requireAuth, requireTenant, express.json(), async (req, res) => {
  const { name, sku, description, imageUrl, stock, variants } = req.body || {};
  if (!name) return res.status(400).json({ success: false, error: 'Namn krävs' });

  const doc = await InventoryItem.create({
    tenant: req.tenant,
    name,
    sku: (sku || '').trim() || undefined,
    description,
    imageUrl,
    stock: Array.isArray(variants) && variants.length ? 0 : (Number(stock) || 0),
    variants: Array.isArray(variants) ? variants.map(v => ({
      key: v.key, sku: v.sku, stock: Number(v.stock) || 0
    })) : []
  });

  flattenItem(doc).forEach(row => {
    bus.emit('stock', { tenant: req.tenant, item: { id: row.id, sku: row.sku, stock: row.stock, name: row.name } });
  });

  res.json({ success: true, item: doc });
});

// Uppdatera produkt/varianter
router.put('/api/inventory/items/:id', requireAuth, requireTenant, express.json(), async (req, res) => {
  const { id } = req.params;
  const { name, description, imageUrl, isActive, sku, stock, variants } = req.body || {};

  const item = await InventoryItem.findOne({ _id: id, tenant: req.tenant });
  if (!item) return res.status(404).json({ success: false, error: 'Hittades ej' });

  if (name !== undefined) item.name = name;
  if (description !== undefined) item.description = description;
  if (imageUrl !== undefined) item.imageUrl = imageUrl;
  if (isActive !== undefined) item.isActive = !!isActive;

  if (Array.isArray(variants)) {
    item.variants = variants.map(v => ({
      key: v.key, sku: v.sku, stock: Math.max(0, Number(v.stock) || 0)
    }));
    item.stock = 0;
    if (sku !== undefined) item.sku = sku;
  } else if (stock !== undefined) {
    item.stock = Math.max(0, Number(stock) || 0);
    if (sku !== undefined) item.sku = sku;
    item.variants = [];
  }

  await item.save();

  flattenItem(item).forEach(row => {
    bus.emit('stock', { tenant: req.tenant, item: { id: row.id, sku: row.sku, stock: row.stock, name: row.name } });
  });

  res.json({ success: true });
});

// Lagerjustering gemensam
async function adjustStock(tenant, { productId, sku, variantKey, quantity, reason, stripeEventId }) {
  const qty = Math.max(1, Number(quantity) || 1);
  const delta = reason === 'purchase' ? -qty : +qty;

  let item = null;
  if (productId) {
    item = await InventoryItem.findOne({ _id: productId, tenant });
  } else if (sku) {
    item = await InventoryItem.findOne({ tenant, $or: [{ sku }, { 'variants.sku': sku }] });
  }
  if (!item) throw new Error('Produkt ej hittad');

  if (item.variants && item.variants.length > 0) {
    const idx = typeof variantKey === 'string'
      ? item.variants.findIndex(v => v.key === variantKey || v.sku === sku)
      : item.variants.findIndex(v => v.sku === sku);
    if (idx < 0) throw new Error('Variant ej hittad');
    item.variants[idx].stock = Math.max(0, (item.variants[idx].stock || 0) + delta);
  } else {
    item.stock = Math.max(0, (item.stock || 0) + delta);
  }

  await item.save();

  await InventoryMovement.create({
    tenant,
    itemId: item._id,
    variantSku: sku || undefined,
    delta: delta > 0 ? 1 : -1,
    reason,
    stripeEventId
  });

  const row = flattenItem(item)[0];
  return { payload: { id: String(item._id), sku: row.sku, stock: row.stock, name: item.name } };
}

// Köp -> -1
router.post('/api/inventory/buy', requireAuth, requireTenant, express.json(), async (req, res) => {
  try {
    const { productId, sku, variantKey, quantity } = req.body || {};
    const { payload } = await adjustStock(req.tenant, { productId, sku, variantKey, quantity, reason: 'purchase' });
    bus.emit('stock', { tenant: req.tenant, item: payload });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// Retur -> +1
router.post('/api/inventory/return', requireAuth, requireTenant, express.json(), async (req, res) => {
  try {
    const { productId, sku, variantKey, quantity } = req.body || {};
    const { payload } = await adjustStock(req.tenant, { productId, sku, variantKey, quantity, reason: 'return' });
    bus.emit('stock', { tenant: req.tenant, item: payload });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/inventory/upload  (CSRF-skyddad via global middleware)
// Returnerar { success, url }
router.post('/api/inventory/upload', requireAuth, requireTenant, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'Ingen fil mottagen' });
      const url = '/uploads/' + req.file.filename; // server.js redan exponerar /uploads/:filename
      return res.json({ success: true, url });
    } catch (err) {
      console.error('Upload-fel:', err);
      return res.status(400).json({ success: false, message: err.message || 'Misslyckad uppladdning' });
    }
  });
  
  module.exports = router;
  
