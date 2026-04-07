declare namespace Express {
  interface Request {
    auth: {
      userId: string;
      email: string;
      role: string;
      type: "access";
    };
  }
}
