import crypto from "crypto";
import redisService from "./redis.js";

class OTPService {
  constructor() {
    this.useRedis = !!redisService;
    this.otpStorage = this.useRedis ? null : new Map();
  }

  generateOTP(length = 6) {
    const digits = "0123456789";
    let otp = "";

    for (let i = 0; i < length; i++) {
      otp += digits[crypto.randomInt(0, digits.length)];
    }

    return otp;
  }

  async storeOTP(email, otp, expiresInMinutes = 10) {
    const expiryTime = Date.now() + expiresInMinutes * 60 * 1000;
    const otpData = {
      otp,
      expiryTime,
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now(),
    };

    if (this.useRedis) {
      const key = `otp:${email}`;

      if (redisService.setJSON) {
        await redisService.setJSON(key, otpData, { ex: expiresInMinutes * 60 });
      } else {
        await redisService.setex(
          key,
          expiresInMinutes * 60,
          JSON.stringify(otpData)
        );
      }
    } else {
      this.otpStorage.set(email, otpData);
      setTimeout(() => {
        this.otpStorage.delete(email);
      }, expiresInMinutes * 60 * 1000 + 1000);
    }

    return { otp, expiryTime };
  }

  async verifyOTP(email, providedOTP) {
    try {
      let otpData;

      if (this.useRedis) {
        const key = `otp:${email}`;

        if (redisService.getJSON) {
          otpData = await redisService.getJSON(key);
        } else {
          const data = await redisService.get(key);
          if (!data) {
            return { success: false, message: "OTP not found or expired" };
          }

          try {
            otpData = typeof data === "string" ? JSON.parse(data) : data;
          } catch (parseError) {
            await redisService.del(key);
            return { success: false, message: "Invalid OTP data format" };
          }
        }
      } else {
        otpData = this.otpStorage.get(email);
      }

      if (!otpData) {
        return { success: false, message: "OTP not found or expired" };
      }

      if (Date.now() > otpData.expiryTime) {
        await this.deleteOTP(email);
        return { success: false, message: "OTP has expired" };
      }

      if (otpData.attempts >= otpData.maxAttempts) {
        await this.deleteOTP(email);
        return { success: false, message: "Maximum OTP attempts exceeded" };
      }

      if (otpData.otp === providedOTP) {
        await this.deleteOTP(email);
        return { success: true, message: "OTP verified successfully" };
      } else {
        otpData.attempts += 1;

        if (this.useRedis) {
          const key = `otp:${email}`;
          const ttl = await redisService.ttl(key);
          if (ttl > 0) {
            if (redisService.setJSON) {
              await redisService.setJSON(key, otpData, { ex: ttl });
            } else {
              await redisService.setex(key, ttl, JSON.stringify(otpData));
            }
          }
        } else {
          this.otpStorage.set(email, otpData);
        }

        return {
          success: false,
          message: `Incorrect OTP. ${
            otpData.maxAttempts - otpData.attempts
          } attempts remaining`,
        };
      }
    } catch (error) {
      console.error("OTP verification error:", error);
      return {
        success: false,
        message: "OTP verification failed due to system error",
      };
    }
  }

  async getOTPStatus(email) {
    try {
      let otpData;

      if (this.useRedis) {
        const key = `otp:${email}`;

        if (redisService.getJSON) {
          otpData = await redisService.getJSON(key);
        } else {
          const data = await redisService.get(key);
          if (data) {
            try {
              otpData = typeof data === "string" ? JSON.parse(data) : data;
            } catch (parseError) {
              await redisService.del(key);
              return null;
            }
          } else {
            otpData = null;
          }
        }
      } else {
        otpData = this.otpStorage.get(email);
      }

      if (!otpData) return null;

      return {
        exists: true,
        expired: Date.now() > otpData.expiryTime,
        attempts: otpData.attempts,
        remainingAttempts: otpData.maxAttempts - otpData.attempts,
        expiresAt: new Date(otpData.expiryTime).toISOString(),
      };
    } catch (error) {
      console.error("Get OTP status error:", error);
      return null;
    }
  }

  async deleteOTP(email) {
    try {
      if (this.useRedis) {
        const key = `otp:${email}`;
        await redisService.del(key);
      } else {
        this.otpStorage.delete(email);
      }
    } catch (error) {
      console.error("Delete OTP error:", error);
    }
  }

  async clearOTP(email) {
    return await this.deleteOTP(email);
  }

  async cleanupExpiredOTPs() {
    if (this.useRedis) {
      return;
    }

    const now = Date.now();
    let cleanedCount = 0;

    for (const [email, otpData] of this.otpStorage.entries()) {
      if (now > otpData.expiryTime) {
        this.otpStorage.delete(email);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  async resendOTP(email, type = "verification", expiresInMinutes = 10) {
    const existingStatus = await this.getOTPStatus(email);

    if (existingStatus && !existingStatus.expired) {
      const timeRemaining = Math.ceil(
        (new Date(existingStatus.expiresAt).getTime() - Date.now()) / 60000
      );
      return {
        success: false,
        message: `Please wait ${timeRemaining} minutes before requesting a new OTP`,
      };
    }

    const otp = this.generateOTP();
    await this.storeOTP(email, otp, expiresInMinutes);

    return {
      success: true,
      message: "New OTP generated successfully",
      otp,
    };
  }

  async rateLimitCheck(email, windowMinutes = 60, maxRequests = 5) {
    if (!this.useRedis) {
      return { allowed: true };
    }

    try {
      const key = `otp_rate_limit:${email}`;
      const current = await redisService.get(key);

      if (!current) {
        await redisService.setex(key, windowMinutes * 60, "1");
        return { allowed: true, remaining: maxRequests - 1 };
      }

      const count = parseInt(current);
      if (count >= maxRequests) {
        const ttl = await redisService.ttl(key);
        return {
          allowed: false,
          remaining: 0,
          resetIn: Math.ceil(ttl / 60),
          message: `Too many OTP requests. Try again in ${Math.ceil(
            ttl / 60
          )} minutes.`,
        };
      }

      await redisService.incr(key);
      return { allowed: true, remaining: maxRequests - count - 1 };
    } catch (error) {
      console.error("Rate limit check error:", error);
      return { allowed: true };
    }
  }
}

const otpService = new OTPService();

if (!otpService.useRedis) {
  setInterval(() => {
    otpService.cleanupExpiredOTPs();
  }, 5 * 60 * 1000);
}

export default otpService;
