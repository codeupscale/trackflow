import { Loader3D } from '@/components/ui/loader-3d';

/**
 * Route-transition loading UI for every page under (dashboard).
 *
 * Next.js renders this automatically while a route segment's server work is in
 * flight. Before this file existed there was no `loading.tsx` anywhere in the
 * app, so navigating between dashboard pages held the previous screen with no
 * feedback that anything was happening.
 */
export default function DashboardLoading() {
  return <Loader3D fullHeight />;
}
