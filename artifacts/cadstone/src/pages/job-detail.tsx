import { useParams } from "wouter";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-6">Job Detail</h1>
      <p className="text-muted-foreground text-sm">Job {params.id} — Codex will build this page.</p>
    </div>
  );
}
