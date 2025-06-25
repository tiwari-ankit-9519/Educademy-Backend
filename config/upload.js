import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let folder = "educademy";

    if (file.mimetype.startsWith("image/")) {
      folder = "educademy/images";
    } else if (file.mimetype.startsWith("video/")) {
      folder = "educademy/videos";
    } else if (file.mimetype.startsWith("audio/")) {
      folder = "educademy/audio";
    } else {
      folder = "educademy/documents";
    }

    if (req.route?.path?.includes("profile")) {
      folder = "educademy/profiles";
    } else if (req.route?.path?.includes("course")) {
      folder = "educademy/courses";
    } else if (req.route?.path?.includes("lesson")) {
      folder = "educademy/lessons";
    }

    return {
      folder,
      allowed_formats: [
        // Images
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "bmp",
        "tiff",
        "svg",
        // Videos
        "mp4",
        "avi",
        "mov",
        "wmv",
        "flv",
        "webm",
        "mkv",
        "m4v",
        "3gp",
        // Audio
        "mp3",
        "wav",
        "aac",
        "ogg",
        "flac",
        "m4a",
        // Documents
        "pdf",
        "doc",
        "docx",
        "txt",
        "rtf",
      ],
      resource_type: "auto",

      ...(file.mimetype.startsWith("video/") && {
        video_codec: "auto",
        quality: "auto:good",
        format: "mp4",
        transformation: [
          {
            quality: "auto:good",
            fetch_format: "auto",
          },
        ],
      }),

      // Image-specific configurations
      ...(file.mimetype.startsWith("image/") && {
        transformation: [
          {
            quality: "auto:good",
            fetch_format: "auto",
          },
        ],
      }),
    };
  },
});

// General upload middleware
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit (adjust as needed)
  },
  fileFilter: (req, file, cb) => {
    // Define allowed MIME types
    const allowedTypes = [
      // Images
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/tiff",
      "image/svg+xml",
      // Videos
      "video/mp4",
      "video/avi",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-flv",
      "video/webm",
      "video/x-matroska",
      "video/3gpp",
      // Audio
      "audio/mpeg",
      "audio/wav",
      "audio/aac",
      "audio/ogg",
      "audio/flac",
      "audio/mp4",
      // Documents
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "application/rtf",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
  },
});

// Specific upload middlewares for different use cases
export const uploadImage = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB for images
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

export const uploadVideo = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB for videos
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"), false);
    }
  },
});

export const uploadAudio = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB for audio
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"), false);
    }
  },
});

export const uploadDocument = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB for documents
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "application/rtf",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Only document files (PDF, DOC, DOCX, TXT, RTF) are allowed"),
        false
      );
    }
  },
});

export const uploadCourseMedia = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/avi",
      "video/quicktime",
      "video/webm",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Only image and video files are allowed for course media"),
        false
      );
    }
  },
});

// ✅ FIXED: Helper function to determine resource type from URL/publicId
const getResourceType = (publicId) => {
  // Check file extension or folder structure to determine resource type
  const lowerPublicId = publicId.toLowerCase();

  // Check for common image extensions
  if (lowerPublicId.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|svg)$/)) {
    return "image";
  }

  // Check for common video extensions
  if (lowerPublicId.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp)$/)) {
    return "video";
  }

  // Check for common audio extensions
  if (lowerPublicId.match(/\.(mp3|wav|aac|ogg|flac|m4a)$/)) {
    return "video"; // Cloudinary treats audio as video resource type
  }

  // Check by folder structure
  if (
    lowerPublicId.includes("/profiles/") ||
    lowerPublicId.includes("/images/")
  ) {
    return "image";
  }

  if (lowerPublicId.includes("/videos/")) {
    return "video";
  }

  if (lowerPublicId.includes("/audio/")) {
    return "video"; // Cloudinary treats audio as video resource type
  }

  // Default to image for profile images and most common use cases
  return "image";
};

// ✅ FIXED: Updated deleteFromCloudinary function
export const deleteFromCloudinary = async (publicId, resourceType = null) => {
  try {
    // If no resource type provided, try to determine it
    const finalResourceType = resourceType || getResourceType(publicId);

    console.log(
      `Deleting from Cloudinary: ${publicId} with resource_type: ${finalResourceType}`
    );

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: finalResourceType,
    });

    console.log(`Cloudinary deletion result:`, result);
    return result;
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);

    // If deletion fails with image type, try with video type (for audio files)
    if (resourceType === null && error.message.includes("resource type")) {
      try {
        console.log(
          `Retrying deletion with video resource type for: ${publicId}`
        );
        const result = await cloudinary.uploader.destroy(publicId, {
          resource_type: "video",
        });
        return result;
      } catch (retryError) {
        console.error(
          "Retry with video resource type also failed:",
          retryError
        );
        throw retryError;
      }
    }

    throw error;
  }
};

export const getOptimizedUrl = (publicId, options = {}) => {
  const defaultOptions = {
    quality: "auto",
    fetch_format: "auto",
  };

  return cloudinary.url(publicId, { ...defaultOptions, ...options });
};

export const getVideoThumbnail = (publicId, options = {}) => {
  const defaultOptions = {
    resource_type: "video",
    format: "jpg",
    quality: "auto",
    ...options,
  };

  return cloudinary.url(publicId, defaultOptions);
};

export default upload;
