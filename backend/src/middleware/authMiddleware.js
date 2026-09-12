import jwt from "jsonwebtoken";

export const protectRoute = (req, res, next) => {
  const header = req.headers.authorization ?? "";

  if (!header.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Missing or malformed Authorization header." });
  }

  const token = header.slice("Bearer ".length).trim();

  if (!token) {
    return res.status(401).json({ message: "Missing or malformed Authorization header." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

export default protectRoute;
