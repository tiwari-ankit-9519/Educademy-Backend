import { config } from "dotenv";
config();

import jwt from "jsonwebtoken";
import getTokenFromHeader from "../utils/getTokenFromHeader.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const isLoggedIn = async (req, res, next) => {
  const token = getTokenFromHeader(req);

  if (!token) {
    return res.status(403).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    req.userAuthId = user.id;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

export default isLoggedIn;
