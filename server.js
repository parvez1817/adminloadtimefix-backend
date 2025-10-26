// server.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// --------------------
// ✅ CORS CONFIGURATION
// --------------------
app.use(cors({ 
  origin: [ 
    "http://localhost:5173",                   // local dev frontend (Vite) 
    "http://localhost:8080",                   // local dev frontend port 8080
    "https://sonaadmin-idcard-portal.netlify.app" // deployed frontend (no trailing slash)
  ],
  methods: ["GET", "POST", "PATCH", "DELETE"],
}));

// Middleware
app.use(express.json());

// Connect to studentidreq database with fast failover to avoid long hangs
const studentDb = mongoose.createConnection(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  autoIndex: false,
});

studentDb.on("connected", () => {
  console.log("✅ Connected to studentidreq database");
});

studentDb.on("error", (err) => {
  console.error("❌ Error connecting to studentidreq database:", err);
});

// Schema for accepted ID cards (acceptedidcards collection)
const acceptedIdCardSchema = new mongoose.Schema({
  registerNumber: String,
  name: String,
  dob: String,
  department: String,
  year: String,
  section: String,
  libraryCode: String,
  reason: String,
  status: {
    type: String,
    default: "accepted",
  },
  acceptedAt: {
    type: Date,
    default: Date.now,
  },
});

const AcchistoryIdSchema = new mongoose.Schema({
  registerNumber: String,
  name: String,
  dob: String,
  department: String,
  year: String,
  section: String,
  libraryCode: String,
  reason: String,
  status: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const AcchistoryId = studentDb.model(
  "acchistoryids",
  AcchistoryIdSchema,
  "acchistoryids"
);

const AcceptedIdCard = studentDb.model(
  "acceptedidcards",
  acceptedIdCardSchema,
  "acceptedidcards"
);

// Schema for admin IDs (adminids collection)
const adminIdSchema = new mongoose.Schema({
  adminid: String,
});
// Ensure index for fast lookups (match existing unique index if present)
adminIdSchema.index({ adminid: 1 }, { unique: true, name: "adminid_1" });

const AdminId = studentDb.model("adminids", adminIdSchema, "adminids");

// Schema for print IDs (printids collection)
const printIdSchema = new mongoose.Schema({
  registerNumber: String,
  name: String,
  dob: String,
  department: String,
  year: String,
  section: String,
  libraryCode: String,
  reason: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const PrintId = studentDb.model("printids", printIdSchema, "printids");

// Block requests until DB is ready to avoid 30-40s hangs on cold start
app.use((req, res, next) => {
  if (studentDb.readyState !== 1) {
    return res.status(503).json({ error: "Database connecting. Please retry." });
  }
  next();
});

// Health check
app.get("/healthz", (req, res) => {
  res.json({ ok: true, db: studentDb.readyState === 1 });
});

// ✅ API: Get all printed IDs
app.get("/api/printed", async (req, res) => {
  try {
    const printData = await PrintId.find({});
    res.json(printData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ API: Get all accepted history IDs
app.get("/api/acchistoryids", async (req, res) => {
  try {
    const acchistoryData = await AcchistoryId.find({});
    res.json(acchistoryData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ API: Get all accepted ID cards
app.get("/api/accepted-idcards", async (req, res) => {
  try {
    const acceptedCards = await AcceptedIdCard.find({});
    res.json(acceptedCards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ API: Store accepted ID card request and delete from printids
app.post("/api/accept-idcard", async (req, res) => {
  try {
    if (studentDb.readyState !== 1) {
      return res.status(500).json({ error: "Database not connected" });
    }

    // Save to acceptedidcards collection
    const acceptedIdCard = new AcceptedIdCard(req.body);
    const savedCard = await acceptedIdCard.save();

    // Delete from printids collection
    await PrintId.deleteOne({ registerNumber: req.body.registerNumber });

    res.status(201).json({
      message: "ID card request accepted successfully",
      data: savedCard,
    });
  } catch (err) {
    console.error("Error processing ID card request:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ API: Login check for admin ID
app.post("/api/login", async (req, res) => {
  const { adminId } = req.body;
  try {
    const admin = await AdminId.findOne({ adminid: adminId }, { _id: 1 }).lean();
    if (admin) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: "Invalid admin ID" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Start the server
// Create indexes after connection established
studentDb.once("open", async () => {
  try {
    await AdminId.createIndexes();
    console.log("✅ Indexes ensured for adminids");
  } catch (e) {
    if (e?.codeName === 'IndexKeySpecsConflict' || e?.code === 86) {
      console.log("ℹ️ Index already exists with different options; keeping existing.");
    } else {
      console.error("❌ Failed ensuring indexes:", e);
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
