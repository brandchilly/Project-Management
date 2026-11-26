import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TaskDetail } from './TaskDetail';

// Direct link to a task (#/tasks/:id), e.g. from a notification.
export function TaskPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/my-tasks'))}>
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>
      <Card className="p-5">{id && <TaskDetail taskId={id} />}</Card>
    </div>
  );
}
