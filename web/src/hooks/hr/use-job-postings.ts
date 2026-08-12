import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  JobPosting,
  JobPostingInput,
} from '@/lib/validations/job-posting';
import { toast } from 'sonner';

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    from: number | null;
    to: number | null;
  };
}

interface UseJobPostingsParams {
  department_id?: string;
  employment_type?: string;
  is_published?: boolean;
  search?: string;
  page?: number;
}

export function useJobPostings(params?: UseJobPostingsParams) {
  return useQuery<PaginatedResponse<JobPosting>>({
    queryKey: ['job-postings', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number | boolean> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.department_id)
        queryParams.department_id = params.department_id;
      if (params?.employment_type)
        queryParams.employment_type = params.employment_type;
      if (params?.is_published !== undefined)
        queryParams.is_published = params.is_published;
      if (params?.search) queryParams.search = params.search;
      const res = await api.get('/hr/job-postings', { params: queryParams });
      return res.data;
    },
  });
}

export function useCreateJobPosting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: JobPostingInput) => {
      const res = await api.post('/hr/job-postings', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-postings'] });
      toast.success('Job posting created');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create job posting');
    },
  });
}

export function useUpdateJobPosting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: JobPostingInput & { id: string }) => {
      const res = await api.put(`/hr/job-postings/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-postings'] });
      toast.success('Job posting updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update job posting');
    },
  });
}

/**
 * Publish / unpublish. Separate endpoint from update because it is gated by
 * job_postings.publish — editing a posting must not be able to push it live.
 */
export function useSetJobPostingPublished() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      is_published,
    }: {
      id: string;
      is_published: boolean;
    }) => {
      const res = await api.patch(`/hr/job-postings/${id}/publish`, {
        is_published,
      });
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['job-postings'] });
      toast.success(
        variables.is_published
          ? 'Job posting published to the careers page'
          : 'Job posting unpublished'
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to change publish state');
    },
  });
}

export function useDeleteJobPosting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/hr/job-postings/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-postings'] });
      toast.success('Job posting deleted');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete job posting');
    },
  });
}
