declare namespace Express {
  interface Request {
    auth?: {
      userId: string;
      email: string;
      role: string;
      type: "access" | "upload";
      patId?: string;
      patScope?: "read" | "read_write";
    };
  }
  namespace Multer {
    interface File {
      // SHA-256 hex digest of the file content, computed by the custom
      // hashing storage engine in `lib/uploads.ts`. Used by the multipart
      // idempotency middleware to fingerprint upload bodies without a
      // double read of the saved file.
      contentHash?: string;
    }
  }
}
