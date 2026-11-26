import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { formatDateTime } from '@/lib/dates';
import type { Tables } from '@/types/database';

type FileRow = Tables<'files'> & { uploader: Pick<Tables<'profiles'>, 'full_name' | 'email'> | null };

const MAX_BYTES = 50 * 1024 * 1024;

interface FilesPanelProps {
  // Task files when taskId is set; otherwise every file of the client.
  taskId?: string;
  clientId?: string | null;
  // Team-level tasks have no client; their files live under the department.
  departmentId?: string | null;
  canUpload?: boolean;
}

const filesKey = (taskId?: string, clientId?: string | null) => ['files', taskId ?? 'client', clientId ?? ''];

function prettySize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesPanel({ taskId, clientId, departmentId, canUpload = true }: FilesPanelProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = filesKey(taskId, clientId);

  const files = useQuery({
    queryKey: key,
    enabled: !!(taskId || clientId),
    queryFn: async () => {
      let q = supabase
        .from('files')
        .select('*, uploader:profiles(full_name, email)')
        .order('created_at', { ascending: false })
        .limit(100);
      q = taskId ? q.eq('task_id', taskId) : q.eq('client_id', clientId!);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as FileRow[];
    },
  });

  const upload = useMutation({
    mutationFn: async (list: FileList) => {
      const root = clientId ? `client/${clientId}` : departmentId ? `department/${departmentId}` : null;
      if (!root) throw new Error('This task has no client or department to store files under.');
      for (const file of Array.from(list)) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 50 MB.`);
        const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-120);
        const path = `${root}/${taskId ?? 'thread'}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage.from('files').upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
        if (upErr) throw new Error(errorMessage(upErr));
        const { error } = await supabase.from('files').insert({
          task_id: taskId ?? null,
          client_id: clientId ?? null,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
        });
        if (error) {
          await supabase.storage.from('files').remove([path]);
          throw new Error(errorMessage(error));
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files'] });
      toast({ type: 'success', title: 'Uploaded' });
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Upload failed', description: e.message }),
    onSettled: () => {
      if (input.current) input.current.value = '';
    },
  });

  const remove = useMutation({
    mutationFn: async (f: FileRow) => {
      const { error } = await supabase.from('files').delete().eq('id', f.id);
      if (error) throw new Error(errorMessage(error));
      await supabase.storage.from('files').remove([f.storage_path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not delete', description: e.message }),
  });

  const open = async (f: FileRow) => {
    const { data, error } = await supabase.storage.from('files').createSignedUrl(f.storage_path, 60, {
      download: f.file_name,
    });
    if (error || !data) {
      toast({ type: 'error', title: 'Could not open file', description: errorMessage(error) });
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  return (
    <div>
      {files.isLoading ? (
        <div className="skeleton h-10 w-full" />
      ) : (files.data ?? []).length === 0 ? (
        <p className="py-1 text-sm text-graphite-500">No files yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {files.data!.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-graphite-800 bg-ink-200/60 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-graphite-400" />
              <button className="min-w-0 flex-1 text-left" onClick={() => open(f)}>
                <p className="truncate text-sm text-white">{f.file_name}</p>
                <p className="truncate text-xs text-graphite-500">
                  {prettySize(f.size_bytes)} · {f.uploader?.full_name || f.uploader?.email} · {formatDateTime(f.created_at)}
                </p>
              </button>
              <Button variant="ghost" size="icon-sm" aria-label={`Download ${f.file_name}`} onClick={() => open(f)}>
                <Download className="h-4 w-4" />
              </Button>
              {(f.uploaded_by === profile?.id || profile?.role === 'admin') && (
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.file_name}`} onClick={() => remove.mutate(f)}>
                  <Trash2 className="h-4 w-4 text-error-400" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
          >
            <Paperclip className="h-4 w-4" />
            {upload.isPending ? 'Uploading…' : 'Attach file'}
          </Button>
        </>
      )}
    </div>
  );
}
