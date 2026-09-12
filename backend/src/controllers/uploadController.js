import cloudinary from "../config/cloudinary.js";
import User from "../models/User.js";
import { broadcast } from "../sockets/registry.js";

const PROFILE_PHOTO_FOLDER = "swiftchat/profile-photos";

// multer keeps the file in memory, so it is streamed straight to Cloudinary
// rather than being written to disk first.
const uploadBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: PROFILE_PHOTO_FOLDER, resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );

    stream.end(buffer);
  });

// multer's fileFilter only sees the client-supplied mimetype, so a non-image
// can still reach Cloudinary disguised as one. Cloudinary rejects it, and that
// is a bad request from the caller rather than a server fault.
const isInvalidImageError = (error) => {
  const message = error?.message ?? "";
  return message.includes("Invalid image file") || error?.http_code === 400;
};

export const uploadProfilePhoto = async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ message: 'No file uploaded. Attach an image under the "photo" field.' });
  }

  try {
    // Checked before uploading so a deleted account can't leave a stray asset.
    const existing = await User.findById(req.userId).select("profilePhotoId").lean();
    if (!existing) {
      return res.status(404).json({ message: "User not found." });
    }

    let result;
    try {
      result = await uploadBuffer(req.file.buffer);
    } catch (error) {
      if (isInvalidImageError(error)) {
        return res.status(400).json({
          message: "The uploaded file is not a valid image.",
        });
      }
      throw error;
    }

    // Only after the new upload succeeds — otherwise a failure would leave the
    // user with no photo at all.
    const previousId = existing.profilePhotoId;
    if (previousId && previousId !== result.public_id) {
      try {
        await cloudinary.uploader.destroy(previousId);
      } catch (error) {
        // A leftover asset is not worth failing the request over.
        console.error("Failed to delete previous profile photo:", previousId, error);
      }
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePhoto: result.secure_url, profilePhotoId: result.public_id },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // A profile photo shows up in other people's sidebars, member lists and
    // threads, so anyone connected may need to re-render it.
    broadcast("profile_updated", {
      userId: String(user._id),
      username: user.username,
      profilePhoto: user.profilePhoto,
    });

    return res.status(200).json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        profilePhoto: user.profilePhoto,
        profilePhotoId: user.profilePhotoId,
        createdAt: user.createdAt,
      },
      photo: {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
      },
    });
  } catch (error) {
    console.error("uploadProfilePhoto failed:", error);
    return res.status(500).json({ message: "Could not upload image." });
  }
};

export default uploadProfilePhoto;
