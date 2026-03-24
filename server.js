require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// penyimpanan sementara
let transactions = {};
let links = {};

function getMidtransAuthHeader() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const encoded = Buffer.from(serverKey + ":").toString("base64");
  return `Basic ${encoded}`;
}

function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

// 1. Buat pembayaran QRIS
app.get("/create-payment", async (req, res) => {
  try {
    const orderId = "order-" + Date.now();
    const grossAmount = 2000;

    const payload = {
      payment_type: "qris",
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount
      },
      qris: {
        acquirer: "gopay"
      }
    };

    const response = await axios.post(
      "https://api.sandbox.midtrans.com/v2/charge",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": getMidtransAuthHeader(),
          "X-Override-Notification": `${process.env.BASE_URL}/webhook`
        }
      }
    );

    transactions[orderId] = {
      status: "PENDING",
      midtrans_status: response.data.transaction_status || "pending",
      token: null
    };

    // cari QR string / actions untuk frontend
    let qrString = response.data.qr_string || null;
    let qrUrl = null;

    if (Array.isArray(response.data.actions)) {
      const qrAction = response.data.actions.find(
        (a) =>
          a.name === "generate-qr-code" ||
          a.name === "generate_qr_code" ||
          (a.url && a.url.includes("qr"))
      );
      if (qrAction) {
        qrUrl = qrAction.url;
      }
    }

    res.json({
      order_id: orderId,
      transaction_status: response.data.transaction_status,
      qr_string: qrString,
      qr_url: qrUrl,
      raw: response.data
    });
  } catch (err) {
    const errorData = err.response?.data || { message: err.message };
    console.log("ERROR MIDTRANS:", errorData);
    res.status(500).json(errorData);
  }
});

// 2. Webhook dari Midtrans
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;
    console.log("Webhook Midtrans masuk:", data);

    const orderId = data.order_id;
    const transactionStatus = data.transaction_status;
    const fraudStatus = data.fraud_status;

    if (!transactions[orderId]) {
      transactions[orderId] = {
        status: "PENDING",
        midtrans_status: transactionStatus || "unknown",
        token: null
      };
    }

    // anggap settlement/capture sebagai berhasil
    if (
      transactionStatus === "settlement" ||
      (transactionStatus === "capture" && fraudStatus === "accept")
    ) {
      let token = transactions[orderId].token;

      if (!token) {
        token = generateToken();
        links[token] = {
          used: false,
          file: process.env.DRIVE_LINK
        };
      }

      transactions[orderId] = {
        status: "PAID",
        midtrans_status: transactionStatus,
        token: token
      };

      console.log("Payment sukses:", orderId);
    } else if (
      transactionStatus === "expire" ||
      transactionStatus === "cancel" ||
      transactionStatus === "deny"
    ) {
      transactions[orderId] = {
        ...(transactions[orderId] || {}),
        status: "FAILED",
        midtrans_status: transactionStatus,
        token: null
      };
    } else {
      transactions[orderId] = {
        ...(transactions[orderId] || {}),
        status: "PENDING",
        midtrans_status: transactionStatus || "pending",
        token: transactions[orderId].token || null
      };
    }

    res.status(200).send("OK");
  } catch (err) {
    console.log("WEBHOOK ERROR:", err.message);
    res.status(500).send("Webhook error");
  }
});

// 3. Cek status pembayaran
app.get("/check-status/:id", (req, res) => {
  const id = req.params.id;

  if (!transactions[id]) {
    return res.json({ status: "NOT_FOUND" });
  }

  res.json(transactions[id]);
});

// 4. Download link sekali pakai
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
