import mongoose from "mongoose";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  // minlength applies to the plaintext: Mongoose runs validation before
  // user-defined pre('save') hooks, so it is checked ahead of the hashing
  // hook below. Second layer behind the explicit check in authController.
  password: {
    type: String,
    required: true,
    minlength: [8, "Password must be at least 8 characters."],
  },
  profilePhoto: {
    type: String,
    default: "",
  },
  // Cloudinary public_id for the current profile photo, kept so the previous
  // asset can be deleted when a new one is uploaded.
  profilePhotoId: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
