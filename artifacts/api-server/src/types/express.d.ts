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
}
