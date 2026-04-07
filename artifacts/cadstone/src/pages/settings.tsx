import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/auth";
import api from "@/lib/api";
import { toast } from "sonner";

export default function SettingsPage() {
  const { user, setAuth, accessToken } = useAuthStore();
  const [fullName, setFullName] = useState(user?.fullName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setEmail(user.email);
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.put("/users/me", { full_name: fullName });
      setAuth(res.data.user, accessToken!);
      toast.success("Profile updated successfully");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold text-foreground mb-6">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                readOnly
                className="bg-muted/50 cursor-not-allowed"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div>
                <Badge variant="secondary" className="capitalize">
                  {user?.role?.replace("_", " ") || "—"}
                </Badge>
              </div>
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
