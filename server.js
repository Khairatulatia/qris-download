require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT;

// penyimpanan sementara
let transactions = {};
let links = {};

// 🔹 1. Create Payment (Duitku)
app.get("/create-payment", async (req, res) => {
  try {
    const merchantCode = process.env.DUITKU_MERCHANT_CODE;
    const apiKey = process.env.DUITKU_API_KEY;

    const paymentAmount = 10000;
    const merchantOrderId = "order-" + Date.now();

    const signature = crypto
      .createHash("md5")
      .update(merchantCode + merchantOrderId + paymentAmount + apiKey)
      .digest("hex");

    const response = await axios.post(
      "https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry",
      {
        merchantCode,
        paymentAmount,
        merchantOrderId,
        productDetails: "Download File",
        email: "test@email.com",
        paymentMethod: "QRIS",
        callbackUrl: process.env.BASE_URL + "/webhook",
        returnUrl: process.env.BASE_URL,
        signature
      }
    );

    transactions[merchantOrderId] = {
      status: "PENDING"
    };

    res.json({
      order_id: merchantOrderId,
      payment_url: response.data.paymentUrl
    });

  } catch (err) {
    console.log("ERROR DUITKU FULL:", err.response?.data || err.message);
    res.status(500).json(err.response?.data || { error: err.message });
  }
});

// 🔹 2. Webhook Duitku
app.post("/webhook", (req, res) => {
  const data = req.body;

  console.log("Webhook masuk:", data);

  if (data.resultCode === "00") {
    const orderId = data.merchantOrderId;

    const token = Math.random().toString(36).substring(2);

    links[token] = {
      used: false,
      file: process.env.DRIVE_LINK
    };

    transactions[orderId] = {
      status: "PAID",
      token: token
    };

    console.log("Payment sukses:", orderId);
  }

  res.send("OK");
});

// 🔹 3. Check status
app.get("/check-status/:id", (req, res) => {
  const id = req.params.id;

  if (!transactions[id]) {
    return res.json({ status: "NOT_FOUND" });
  }

  res.json(transactions[id]);
});

// 🔹 4. Download
app.get("/download/:token", (req, res) => {
  const token = req.params.token;

  if (!links[token] || links[token].used) {
    return res.send("Link sudah tidak valid 😌");
  }

  links[token].used = true;

  res.redirect(links[token].file);
});

app.listen(PORT, () => {
  console.log("Server jalan di port", PORT);
});