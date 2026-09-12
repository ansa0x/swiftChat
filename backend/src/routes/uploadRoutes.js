import express from "express";
import multer from "multer";

import { uploadProfilePhoto } from "../controllers/uploadController.js";
import { protectRoute } from "../middleware/authMiddleware.js";

const router = express.Router();

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) {
      const error = new Error("Only image files are allowed.");
      error.code = "UNSUPPORTED_FILE_TYPE";
      return cb(error);
    }

    cb(null, true);
  },
});

// multer surfaces size/type problems as errors, which would otherwise land in
// express's default handler as a 500. Translate them into clear 400s instead.
const acceptPhoto = (req, res, next) => {
  upload.single("photo")(req, res, (error) => {
    if (!error) return next();

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Image must be 5MB or smaller." });
    }

    if (error.code === "UNSUPPORTED_FILE_TYPE") {
      return res.status(400).json({ message: error.message });
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res
        .status(400)
        .json({ message: 'Unexpected file field. Use "photo".' });
    }

    return res.status(400).json({ message: error.message ?? "Upload failed." });
  });
};

router.post("/profile-photo", protectRoute, acceptPhoto, uploadProfilePhoto);

export default router;
