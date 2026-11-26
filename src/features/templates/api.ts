import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query-keys';
import type { Tables } from '@/types/database';

export type Template = Tables<'templates'>;
export type TemplateTask = Tables<'template_tasks'>;
export type TemplateStage = Tables<'template_stages'> & { template_tasks: TemplateTask[] };
export type TemplateDetail = Template & { template_stages: TemplateStage[] };

export function useTemplates() {
  return useQuery({
    queryKey: queryKeys.templates,
    queryFn: async () => {
      const { data, error } = await supabase.from('templates').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.template(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('templates')
        .select('*, template_stages(*, template_tasks(*))')
        .eq('id', id!)
        .single();
      if (error) throw error;
      const detail = data as TemplateDetail;
      detail.template_stages = sortStages(detail.template_stages).map((s) => ({
        ...s,
        template_tasks: [...s.template_tasks].sort((a, b) => a.position - b.position),
      }));
      return detail;
    },
  });
}

// Launch stages in order, then Post-Launch stages.
export function sortStages<T extends { position: number; is_post_launch: boolean }>(stages: T[]): T[] {
  return [...stages].sort((a, b) => Number(a.is_post_launch) - Number(b.is_post_launch) || a.position - b.position);
}

// Mirrors private.template_stage_offsets(): launch stages run back to back from Day 0; Post-Launch
// starts after the last launch stage and ends at its latest task.
export function stageOffsets(stages: TemplateStage[]): Map<string, { start: number; end: number }> {
  const result = new Map<string, { start: number; end: number }>();
  let end = -1;
  let lastLaunchEnd = 0;
  for (const s of sortStages(stages)) {
    if (s.is_post_launch) {
      const start = lastLaunchEnd + 1;
      const maxTask = Math.max(start, ...s.template_tasks.map((t) => t.due_day_offset));
      result.set(s.id, { start, end: maxTask });
    } else {
      const start = end + 1;
      end = start + Math.max(s.duration_days, 1) - 1;
      lastLaunchEnd = end;
      result.set(s.id, { start, end });
    }
  }
  return result;
}

export function dayRange({ start, end }: { start: number; end: number }) {
  return start === end ? `Day ${start}` : `Day ${start}–${end}`;
}
