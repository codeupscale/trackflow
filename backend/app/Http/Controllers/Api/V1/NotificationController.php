<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\NotificationPreferences;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * The bell.
 *
 * Every route here reads through `$request->user()->notifications()`, so a user
 * can only ever reach their own rows — there is no id-addressed lookup that
 * could be pointed at someone else's notification.
 */
class NotificationController extends Controller
{
    /**
     * This user's notifications, newest first.
     *
     * `unread_count` rides along on every page rather than living behind its
     * own endpoint: the bell needs both numbers at once, and two calls to draw
     * one badge is a round trip nobody gets back.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $query = $user->notifications();

        if ($request->boolean('unread')) {
            $query->whereNull('read_at');
        }

        $perPage = min((int) $request->input('per_page', 15), 50);
        $notifications = $query->paginate($perPage);

        return response()->json([
            'data' => collect($notifications->items())->map(fn ($n) => $this->present($n))->all(),
            'meta' => [
                'current_page' => $notifications->currentPage(),
                'last_page' => $notifications->lastPage(),
                'total' => $notifications->total(),
                'unread_count' => $user->unreadNotifications()->count(),
            ],
        ]);
    }

    public function markRead(Request $request, string $id): JsonResponse
    {
        $notification = $this->findOwn($request, $id);

        // Idempotent on purpose: the panel marks on open, and re-marking a read
        // notification must not move its timestamp or 404.
        if ($notification->read_at === null) {
            $notification->markAsRead();
        }

        return response()->json(['data' => $this->present($notification->fresh())]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $count = $request->user()->unreadNotifications()->update(['read_at' => now()]);

        return response()->json([
            'message' => 'All notifications marked as read.',
            'data' => ['marked' => $count],
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->findOwn($request, $id)->delete();

        return response()->json(['message' => 'Notification removed.']);
    }

    /**
     * The notification groups this person can mute, and which are muted.
     */
    public function preferences(Request $request): JsonResponse
    {
        return response()->json([
            'data' => NotificationPreferences::forUser($request->user()),
        ]);
    }

    public function updatePreferences(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'muted' => ['present', 'array'],
            'muted.*' => ['string', 'in:' . implode(',', array_keys(NotificationPreferences::GROUPS))],
        ]);

        NotificationPreferences::save($request->user(), $validated['muted']);

        return response()->json([
            'message' => 'Notification preferences saved.',
            'data' => NotificationPreferences::forUser($request->user()->fresh()),
        ]);
    }

    /**
     * The caller's own notification, or 404.
     *
     * The id is checked for uuid SHAPE before it reaches the query. The column
     * is a Postgres uuid, and Postgres rejects a malformed literal outright —
     * so "not-a-uuid" surfaced as a 500 "invalid input syntax" rather than the
     * 404 it is. A malformed id and a well-formed id belonging to someone else
     * are the same answer to the caller: there is nothing of yours here.
     */
    private function findOwn(Request $request, string $id)
    {
        abort_unless(Str::isUuid($id), 404);

        return $request->user()->notifications()->findOrFail($id);
    }

    /**
     * Flatten the stored payload into the shape the bell renders.
     *
     * `data` is deliberately unwrapped: the client should never have to know
     * that Laravel keeps the interesting half inside a JSON column.
     */
    private function present($notification): array
    {
        $data = $notification->data ?? [];

        return [
            'id' => $notification->id,
            'category' => $data['category'] ?? $notification->type,
            'title' => $data['title'] ?? '',
            'body' => $data['body'] ?? '',
            'url' => $data['url'] ?? null,
            'meta' => $data['meta'] ?? [],
            'read_at' => $notification->read_at?->toIso8601String(),
            'created_at' => $notification->created_at?->toIso8601String(),
        ];
    }
}
