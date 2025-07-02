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
    } else if (req.route?.path?.includes("assignment")) {
      folder = file.mimetype.startsWith("image/")
        ? "educademy/assignments/images"
        : "educademy/assignments/documents";
    } else if (req.route?.path?.includes("verification")) {
      folder = "educademy/verification";
    }

    return {
      folder,
      allowed_formats: [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "bmp",
        "tiff",
        "svg",
        "mp4",
        "avi",
        "mov",
        "wmv",
        "flv",
        "webm",
        "mkv",
        "m4v",
        "3gp",
        "mp3",
        "wav",
        "aac",
        "ogg",
        "flac",
        "m4a",
        "pdf",
        "doc",
        "docx",
        "ppt",
        "pptx",
        "xls",
        "xlsx",
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

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/tiff",
      "image/svg+xml",
      "video/mp4",
      "video/avi",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-flv",
      "video/webm",
      "video/x-matroska",
      "video/3gpp",
      "audio/mpeg",
      "audio/wav",
      "audio/aac",
      "audio/ogg",
      "audio/flac",
      "audio/mp4",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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

export const uploadImage = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
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
    fileSize: 500 * 1024 * 1024,
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
    fileSize: 50 * 1024 * 1024,
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
    fileSize: 25 * 1024 * 1024,
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

export const uploadAssignmentResources = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "application/rtf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only document and image files are allowed for assignment resources"
        ),
        false
      );
    }
  },
});

export const uploadCourseMedia = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024,
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

const getResourceType = (publicId, mimeType = null) => {
  const lowerPublicId = publicId.toLowerCase();

  if (mimeType) {
    if (mimeType.startsWith("image/")) {
      return "image";
    }
    if (mimeType.startsWith("video/")) {
      return "video";
    }
    if (mimeType.startsWith("audio/")) {
      return "video";
    }
    if (mimeType.startsWith("application/") || mimeType.startsWith("text/")) {
      return "raw";
    }
  }

  if (lowerPublicId.match(/\.(jpg|jpeg|png|gif|webp|bmp|tiff|svg)$/)) {
    return "image";
  }

  if (lowerPublicId.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v|3gp)$/)) {
    return "video";
  }

  if (lowerPublicId.match(/\.(mp3|wav|aac|ogg|flac|m4a)$/)) {
    return "video";
  }

  if (lowerPublicId.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|rtf)$/)) {
    return "raw";
  }

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
    return "video";
  }

  if (
    lowerPublicId.includes("/documents/") ||
    lowerPublicId.includes("/assignments/")
  ) {
    return "raw";
  }

  return "image";
};

export const deleteFromCloudinary = async (
  publicId,
  resourceType = null,
  mimeType = null
) => {
  try {
    const finalResourceType =
      resourceType || getResourceType(publicId, mimeType);

    console.log(
      `Attempting to delete from Cloudinary: ${publicId} with resource_type: ${finalResourceType}`
    );

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: finalResourceType,
    });

    console.log(`Cloudinary deletion result:`, result);

    if (result.result !== "ok" && !resourceType) {
      const alternativeTypes = ["image", "video", "raw"].filter(
        (type) => type !== finalResourceType
      );

      for (const altType of alternativeTypes) {
        try {
          console.log(
            `Retrying deletion with resource type: ${altType} for ${publicId}`
          );

          const retryResult = await cloudinary.uploader.destroy(publicId, {
            resource_type: altType,
          });

          if (retryResult.result === "ok") {
            console.log(`Successfully deleted with resource type: ${altType}`);
            return retryResult;
          }
        } catch (retryError) {
          console.log(
            `Failed to delete with resource type: ${altType}`,
            retryError.message
          );
        }
      }
    }

    return result;
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);
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
