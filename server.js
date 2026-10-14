const express = require('express');
const path = require('path');
const fs = require('fs');
const payhamyon = require('./payhamyon');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const CALLBACK_URL = `${PUBLIC_URL}/payhamyon/webhook`;

// ========== Ma'lumotlar bazasi (JSON fayl) ==========
const DB_FILE = path.join(__dirname, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ orders: {}, processed: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ========== Karta ma'lumotlari ==========
const CARD_INFO = {
  number: '9860 1606 3844 8334',
  holder: 'AKMAL G'
};

// ========== API: Karta ma'lumotlari ==========
app.get('/api/card', (req, res) => {
  res.json(CARD_INFO);
});

// ========== API: To'lov yaratish ==========
app.post('/api/order/create', async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Summani kiriting' });
    }

    const orderId = 'ORDER_' + Date.now();
    const db = loadDB();

    // Buyurtma yaratamiz
    db.orders[orderId] = {
      id: orderId,
      amount: Number(amount),
      status: 'pending',
      createdAt: new Date().toISOString(),
      paidAt: null,
      card: null,
      payAmount: null,
      token: null,
    };
    saveDB(db);

    // PayHamyon orqali to'lov yaratamiz
    const payment = await payhamyon.createPayment(Number(amount), CALLBACK_URL);
    console.log('💳 createPayment javobi:', payment);

    if (!payment.success || !payment.token) {
      return res.status(400).json({
        error: 'To\'lov yaratilmadi',
        details: payment,
      });
    }

    // Token'ni saqlaymiz
    const db2 = loadDB();
    db2.orders[orderId].token = payment.token;
    saveDB(db2);

    // To'lov havolasi
    const payUrl = payment.pay_url
      || payment.url
      || `${payment.base_url || 'https://user91.hostx.uz'}/pay/${payment.token}`;

    return res.json({
      success: true,
      order_id: orderId,
      token: payment.token,
      pay_url: payUrl,
      amount: Number(amount),
    });

  } catch (err) {
    console.error('❌ /api/order/create xatolik:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ========== WEBHOOK — PayHamyon shu yerga POST yuboradi ==========
app.post('/payhamyon/webhook', async (req, res) => {
  const payload = req.body;
  console.log('📥 Webhook keldi:', JSON.stringify(payload, null, 2));

  try {
    // 1) Event tekshirish
    if (payload.event !== 'payment.paid') {
      console.log('⚠️ Noto\'g\'ri event:', payload.event);
      return res.status(200).json({ ok: true });
    }

    const db = loadDB();

    // 2) Idempotentlik
    if (db.processed[payload.token]) {
      console.log('♻️ Allaqachon ishlangan:', payload.token);
      return res.status(200).json({ ok: true, status: 'already_processed' });
    }

    // 3) Buyurtmani token orqali topamiz
    const orderId = Object.keys(db.orders).find(
      id => db.orders[id].token === payload.token
    );

    if (!orderId) {
      console.log('❌ Buyurtma topilmadi, token:', payload.token);
      return res.status(200).json({ ok: true, status: 'order_not_found' });
    }

    const order = db.orders[orderId];

    // 4) Summani tekshirish
    if (Number(order.amount) !== Number(payload.amount)) {
      console.log(`❌ Summa mos emas. Kutilgan: ${order.amount}, Kelgan: ${payload.amount}`);
      return res.status(200).json({ ok: true, status: 'amount_mismatch' });
    }

    // 5) Buyurtmani yangilash
    db.orders[orderId].status = 'paid';
    db.orders[orderId].paidAt = payload.paid_at;
    db.orders[orderId].card = payload.card;
    db.orders[orderId].payAmount = payload.pay_amount;
    db.processed[payload.token] = {
      ...payload,
      processedAt: new Date().toISOString(),
    };
    saveDB(db);

    console.log('✅ To\'lov muvaffaqiyatli:', orderId);

    // 6) MUHIM: 200 OK qaytarish
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('❌ Webhook xatolik:', err);
    return res.status(500).json({ error: 'processing_failed' });
  }
});

// ========== API: Buyurtma holati ==========
app.get('/api/order/check/:orderId', async (req, res) => {
  const db = loadDB();
  const order = db.orders[req.params.orderId];
  if (!order) {
    return res.status(404).json({ error: 'Buyurtma topilmadi' });
  }
  if (!order.token) {
    return res.json({ order, payhamyon: null });
  }
  try {
    const check = await payhamyon.checkPayment(order.token);
    return res.json({ order, payhamyon: check });
  } catch (err) {
    return res.status(500).json({ error: err.message, order });
  }
});

// ========== API: Barcha buyurtmalar (admin uchun) ==========
app.get('/api/orders', (req, res) => {
  const db = loadDB();
  const orders = Object.values(db.orders).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json(orders);
});

// ========== API: Kassa holati ==========
app.get('/api/shop/info', async (req, res) => {
  try {
    const info = await payhamyon.getShopInfo();
    return res.json(info);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ========== API: To'lovni bekor qilish ==========
app.post('/api/order/cancel/:orderId', async (req, res) => {
  const db = loadDB();
  const order = db.orders[req.params.orderId];
  if (!order) {
    return res.status(404).json({ error: 'Buyurtma topilmadi' });
  }
  if (order.status === 'paid') {
    return res.status(400).json({ error: 'To\'langan buyurtmani bekor qilib bo\'lmaydi' });
  }
  try {
    const result = await payhamyon.cancelPayment(order.token);
    order.status = 'cancelled';
    saveDB(db);
    return res.json({ success: true, payhamyon: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ========== Serverni ishga tushirish ==========
app.listen(PORT, () => {
  console.log(`🟢 PayHamyon server ${PORT}-portda ishga tushdi`);
  console.log(`📡 Webhook URL: ${CALLBACK_URL}`);
});
