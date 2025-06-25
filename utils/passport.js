import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/api/auth/google/callback",
      scope: ["profile", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0]?.value;
        if (!email) {
          return done(new Error("No email found in Google profile"), null);
        }

        let user = await prisma.user.findUnique({
          where: { email },
        });

        if (user) {
          if (!user.googleId) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                googleId: profile.id,
                isVerified: true,
                lastLogin: new Date(),
              },
            });
          } else {
            await prisma.user.update({
              where: { id: user.id },
              data: { lastLogin: new Date() },
            });
          }
        } else {
          user = await prisma.user.create({
            data: {
              googleId: profile.id,
              email,
              firstName:
                profile.name?.givenName ||
                profile.displayName?.split(" ")[0] ||
                "User",
              lastName:
                profile.name?.familyName ||
                profile.displayName?.split(" ").slice(1).join(" ") ||
                "",
              profilePicture: profile.photos[0]?.value,
              isVerified: true,
              isActive: true,
              role: "STUDENT",
              authProvider: "GOOGLE",
              lastLogin: new Date(),
            },
          });
        }

        const token = jwt.sign(
          {
            id: user.id,
            email: user.email,
            role: user.role,
          },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
        );

        return done(null, { user, token, isNewUser: !user.googleId });
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: "/api/auth/github/callback",
      scope: ["user:email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error("No email found in GitHub profile"), null);
        }

        let user = await prisma.user.findUnique({
          where: { email },
        });

        if (user) {
          if (!user.githubId) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                githubId: profile.id,
                isVerified: true,
                lastLogin: new Date(),
              },
            });
          } else {
            await prisma.user.update({
              where: { id: user.id },
              data: { lastLogin: new Date() },
            });
          }
        } else {
          user = await prisma.user.create({
            data: {
              githubId: profile.id,
              email,
              firstName:
                profile.displayName?.split(" ")[0] ||
                profile.username ||
                "User",
              lastName:
                profile.displayName?.split(" ").slice(1).join(" ") || "",
              profilePicture: profile.photos?.[0]?.value,
              isVerified: true,
              isActive: true,
              role: "STUDENT",
              authProvider: "GITHUB",
              lastLogin: new Date(),
            },
          });
        }

        const token = jwt.sign(
          {
            id: user.id,
            email: user.email,
            role: user.role,
          },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
        );

        return done(null, { user, token, isNewUser: !user.githubId });
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((authData, done) => {
  done(null, authData);
});

passport.deserializeUser((authData, done) => {
  done(null, authData);
});

export default passport;
