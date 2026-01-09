require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();

/* -------------------- MIDDLEWARE -------------------- */
app.use(
  cors({
    origin: "https://my-task-fronted.vercel.app",
    credentials: true,
  })
);
app.use(express.json());

/* -------------------- DATABASE -------------------- */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error(err));

/* -------------------- CLOUDINARY -------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* -------------------- MULTER SETUP -------------------- */
const taskStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "taskapp/tasks",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
  },
});

const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "taskapp/profilePictures",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
  },
});

const uploadTask = multer({ storage: taskStorage });
const uploadProfile = multer({ storage: profileStorage });

/* -------------------- MODELS -------------------- */
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  hobbies: [String],
  profilePicture: String, // <-- new attribute
});

const taskSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  task: String,
  image: String, // Cloudinary URL
  completed: Boolean,
  date: String,
});

const User = mongoose.model("User", userSchema);
const Task = mongoose.model("Task", taskSchema);

/* -------------------- AUTH MIDDLEWARE -------------------- */
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

/* -------------------- AUTH ROUTES -------------------- */

// SIGNUP
app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  const hashed = await bcrypt.hash(password, 10);
  await User.create({ name, email, password: hashed });

  res.json({ message: "Signup successful" });
});

// LOGIN
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "User not found" });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ message: "Wrong password" });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token });
});

// GET PROFILE
app.get("/me", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("-password");
  res.json(user);
});

/* -------------------- USER ROUTES -------------------- */

app.put("/ChangeName", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { name: req.body.name });
  res.json({ message: "Name updated" });
});

app.put("/ChangePassword", auth, async (req, res) => {
  const hashed = await bcrypt.hash(req.body.newPassword, 10);
  await User.findByIdAndUpdate(req.user.id, { password: hashed });
  res.json({ message: "Password updated" });
});

/* -------------------- PROFILE PICTURE -------------------- */

// Set profile picture
app.post(
  "/SetProfilePicture",
  auth,
  uploadProfile.single("image"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      await User.findByIdAndUpdate(req.user.id, {
        profilePicture: req.file.path,
      });

      res.json({
        message: "Profile picture updated",
        profilePicture: req.file.path,
      });
    } catch (err) {
      console.error("Error setting profile picture:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete profile picture
app.delete("/DeleteProfilePicture", auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      profilePicture: null,
    });

    res.json({ message: "Profile picture deleted" });
  } catch (err) {
    console.error("Error deleting profile picture:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* -------------------- TASK ROUTES -------------------- */

app.post("/AddDailyTasks", auth, async (req, res) => {
  const task = await Task.create({
    userId: req.user.id,
    task: req.body.task,
    completed: false,
    date: new Date().toISOString().split("T")[0],
  });

  res.json(task);
});

app.get("/GetDailyTasks", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const tasks = await Task.find({ userId: req.user.id, date: today });
  res.json(tasks);
});

app.delete("/DeleteTask/:id", auth, async (req, res) => {
  await Task.findByIdAndDelete(req.params.id);
  res.json({ message: "Task deleted" });
});

/* -------------------- TASK DONE + IMAGE UPLOAD -------------------- */
app.post(
  "/TaskDoneUploadPicture",
  auth,
  uploadTask.single("image"),
  async (req, res) => {
    const { taskId } = req.body;

    await Task.findByIdAndUpdate(taskId, {
      completed: true,
      image: req.file.path,
    });

    res.json({
      message: "Task completed and image uploaded",
      imageUrl: req.file.path,
    });
  }
);

/* -------------------- HISTORY -------------------- */
app.get("/GetTaskHistory", auth, async (req, res) => {
  const tasks = await Task.find({
    userId: req.user.id,
    completed: true,
  }).sort({ date: -1 });

  res.json(tasks);
});

/* -------------------- HOBBIES -------------------- */
app.post("/AddHobbies", auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, {
    $push: { hobbies: req.body.hobby },
  });
  res.json({ message: "Hobby added" });
});

/* -------------------- SERVER -------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
