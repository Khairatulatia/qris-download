require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT;

// penyimpanan sementara (gunakan DB kalau mau serius)
let transactions = {};
let links = {};

// 🔹 1. Buat QRIS
app.get("/create-payment", async (req, res) => {
  try {
    const external_id = "order-" + Date.now();

    const response = await axios.post(
      "https://api.xendit.co/qr_codes",
      {
        external_id: external_id,
        type: "DYNAMIC",
        amount: 10000
      },
      {
        auth: {
          username: process.env.XENDIT_API_KEY,
          password: ""
        }
      }
    );

    transactions[external_id] = {
      status: "PENDING"
    };

    res.json({
      external_id,
      qr_string: response.data.qr_string
    });

  } catch (err) {
    res.status(500).send("Error bikin QR");
  }
});

// 🔹 2. Webhook dari Xendit
app.post("/webhook", (req, res) => {
  const data = req.body;

  if (data.status === "PAID") {
    const external_id = data.external_id;

    // generate token
    const token = Math.random().toString(36).substring(2);

    links[token] = {
      used: false,
      file: process.env.DRIVE_LINK
    };

    transactions[external_id] = {
      status: "PAID",
      token: token
    };

    console.log("Payment sukses:", external_id);
  }

  res.send("OK");
});

// 🔹 3. Cek status pembayaran
app.get("/check-status/:id", (req, res) => {
  const id = req.params.id;

  if (!transactions[id]) {
    return res.json({ status: "NOT_FOUND" });
  }

  res.json(transactions[id]);
});

// 🔹 4. Download link sekali pakai
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