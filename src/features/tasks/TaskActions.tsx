import { useState } from 'react';
import { Check, CheckCheck, Clock, Link2, MessageSquareWarning, Play, RotateCcw, Send, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { FormField } from '@/components/form/FormField';
import { useToast } from '@/components/ui/Toast';
import type { TaskStatus } from '@/lib/constants';
import { useReviewDecision, useSetTaskStatus, type Task } from './api';

interface Ctx {
  canManage: boolean;
  isWorker: boolean;
}

// The one big button for a task card: Done, Send for Review, or Client replied.
export function primaryActionFor(task: Task, { canManage, isWorker }: Ctx) {
  if (!(isWorker || canManage)) return null;
  switch (task.status) {
    case 'todo':
    case 'in_progress':
      return task.needs_review
        ? ({ kind: 'review', label: 'Send for Review' } as const)
        : ({ kind: 'status', label: 'Done', to: 'done' as TaskStatus } as const);
    case 'waiting_on_client':
      return { kind: 'status', label: 'Client replied', to: 'in_progress' as TaskStatus } as const;
    default:
      return null;
  }
}

// Shared by task cards and the drawer: status buttons with Undo, review dialogs.
export function useTaskStatusActions() {
  const { toast } = useToast();
  const setStatus = useSetTaskStatus();
  const decide = useReviewDecision();
  const [reviewFor, setReviewFor] = useState<Task | null>(null);
  const [changesFor, setChangesFor] = useState<Task | null>(null);

  const change = (task: Task, to: TaskStatus, opts: { note?: string; link?: string; silent?: boolean } = {}) => {
    const from = task.status;
    setStatus.mutate(
      { task, status: to, note: opts.note, link: opts.link },
      {
        onSuccess: () => {
          if (opts.silent) return;
          const title =
            to === 'done' ? 'Done' : to === 'in_review' ? 'Sent for review' : to === 'waiting_on_client' ? 'Waiting on client' : 'Updated';
          toast({
            type: 'success',
            title,
            description: task.title,
            action:
              to === 'done' && !task.needs_review
                ? { label: 'Undo', onClick: () => change({ ...task, status: to }, from, { silent: true }) }
                : undefined,
          });
        },
        onError: (e) => toast({ type: 'error', title: 'Could not update', description: e.message }),
      }
    );
  };

  const approve = (task: Task) =>
    decide.mutate(
      { task, approve: true },
      {
        onSuccess: () => toast({ type: 'success', title: 'Approved', description: task.title }),
        onError: (e) => toast({ type: 'error', title: 'Could not approve', description: e.message }),
      }
    );

  const dialogs = (
    <>
      <SendForReviewDialog
        task={reviewFor}
        onClose={() => setReviewFor(null)}
        onSend={(link, note) => {
          change(reviewFor!, 'in_review', { link, note });
          setReviewFor(null);
        }}
      />
      <RequestChangesDialog
        task={changesFor}
        onClose={() => setChangesFor(null)}
        onSend={(comment) => {
          const task = changesFor!;
          decide.mutate(
            { task, approve: false, comment },
            {
              onSuccess: () => toast({ type: 'success', title: 'Sent back for changes', description: task.title }),
              onError: (e) => toast({ type: 'error', title: 'Could not send back', description: e.message }),
            }
          );
          setChangesFor(null);
        }}
      />
    </>
  );

  return {
    change,
    approve,
    sendForReview: setReviewFor,
    requestChanges: setChangesFor,
    dialogs,
    pending: setStatus.isPending || decide.isPending,
  };
}

function SendForReviewDialog({
  task,
  onClose,
  onSend,
}: {
  task: Task | null;
  onClose: () => void;
  onSend: (link: string, note: string) => void;
}) {
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const existing = task?.submission_url ?? '';
  const value = link || existing;
  const valid = /^https?:\/\/\S+$/i.test(value);

  return (
    <Dialog
      open={!!task}
      onOpenChange={(o) => {
        if (!o) {
          setLink('');
          setNote('');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send for review</DialogTitle>
          <DialogDescription>{task?.title}. Add the link your manager should check.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField
            label="Link to the work"
            htmlFor="review-link"
            hint="Google Doc, Drive, Figma, page URL… Or attach a file in the task first and leave this empty."
            error={value && !valid ? 'Start the link with https://' : undefined}
          >
            <div className="relative">
              <Link2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite-500" />
              <Input
                id="review-link"
                className="pl-10"
                placeholder="https://"
                inputMode="url"
                value={value}
                onChange={(e) => setLink(e.target.value)}
              />
            </div>
          </FormField>
          <FormField label="Note (optional)" htmlFor="review-note">
            <Textarea id="review-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!!value && !valid} onClick={() => onSend(valid ? value.trim() : '', note.trim())}>
              <Send className="h-4 w-4" />
              Send for Review
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestChangesDialog({
  task,
  onClose,
  onSend,
}: {
  task: Task | null;
  onClose: () => void;
  onSend: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  return (
    <Dialog
      open={!!task}
      onOpenChange={(o) => {
        if (!o) {
          setComment('');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>{task?.title} goes back to In Progress with your comment.</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What needs to change?"
          aria-label="What needs to change"
        />
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!comment.trim()}
            onClick={() => {
              onSend(comment.trim());
              setComment('');
            }}
          >
            Send back
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Full action row for the drawer.
export function TaskActionBar({
  task,
  canManage,
  isWorker,
  actions,
}: {
  task: Task;
  canManage: boolean;
  isWorker: boolean;
  actions: ReturnType<typeof useTaskStatusActions>;
}) {
  const can = isWorker || canManage;
  if (!can) {
    return <p className="text-sm text-graphite-500">Only the assignee or their manager can change this task.</p>;
  }
  const s = task.status;
  const buttons: React.ReactNode[] = [];

  if (s === 'in_review') {
    if (canManage) {
      buttons.push(
        <Button key="approve" variant="success" onClick={() => actions.approve(task)} disabled={actions.pending}>
          <CheckCheck className="h-4 w-4" />
          Approve
        </Button>,
        <Button key="changes" variant="secondary" onClick={() => actions.requestChanges(task)} disabled={actions.pending}>
          <MessageSquareWarning className="h-4 w-4" />
          Request changes
        </Button>
      );
    }
    if (isWorker) {
      buttons.push(
        <Button key="withdraw" variant="ghost" onClick={() => actions.change(task, 'in_progress')} disabled={actions.pending}>
          <Undo2 className="h-4 w-4" />
          Withdraw
        </Button>
      );
    }
  }
  if (s === 'todo') {
    buttons.push(
      <Button key="start" variant="secondary" onClick={() => actions.change(task, 'in_progress')} disabled={actions.pending}>
        <Play className="h-4 w-4" />
        Start
      </Button>
    );
  }
  if (s === 'todo' || s === 'in_progress') {
    buttons.unshift(
      task.needs_review ? (
        <Button key="review" onClick={() => actions.sendForReview(task)} disabled={actions.pending}>
          <Send className="h-4 w-4" />
          Send for Review
        </Button>
      ) : (
        <Button key="done" onClick={() => actions.change(task, 'done')} disabled={actions.pending}>
          <Check className="h-4 w-4" />
          Done
        </Button>
      )
    );
    if (task.needs_review && canManage) {
      buttons.push(
        <Button key="mgr-done" variant="ghost" onClick={() => actions.change(task, 'done')} disabled={actions.pending}>
          <CheckCheck className="h-4 w-4" />
          Mark approved
        </Button>
      );
    }
  }
  if (task.client_dependent && (s === 'todo' || s === 'in_progress')) {
    buttons.push(
      <Button key="wait" variant="outline" onClick={() => actions.change(task, 'waiting_on_client')} disabled={actions.pending}>
        <Clock className="h-4 w-4" />
        Waiting on client
      </Button>
    );
  }
  if (s === 'waiting_on_client') {
    buttons.push(
      <Button key="replied" onClick={() => actions.change(task, 'in_progress')} disabled={actions.pending}>
        <Play className="h-4 w-4" />
        Client replied
      </Button>
    );
  }
  if (s === 'done' && (canManage || !task.needs_review)) {
    buttons.push(
      <Button key="reopen" variant="outline" onClick={() => actions.change(task, 'in_progress')} disabled={actions.pending}>
        <RotateCcw className="h-4 w-4" />
        Reopen
      </Button>
    );
  }
  if (buttons.length === 0) {
    return <p className="text-sm text-graphite-500">With the manager for review.</p>;
  }
  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}
