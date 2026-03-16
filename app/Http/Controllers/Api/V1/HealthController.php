<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;

class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $status = 'ok';
        $checks = [];
        $timings = [];

        // Database check
        $start = microtime(true);
        try {
            DB::connection()->getPdo();
            $checks['database'] = 'ok';
        } catch (\Throwable $e) {
            $checks['database'] = 'error';
            $status = 'degraded';
        }
        $timings['database_ms'] = round((microtime(true) - $start) * 1000, 2);

        // Redis check
        $start = microtime(true);
        try {
            Redis::ping();
            $checks['redis'] = 'ok';
        } catch (\Throwable $e) {
            $checks['redis'] = 'error';
            $status = 'degraded';
        }
        $timings['redis_ms'] = round((microtime(true) - $start) * 1000, 2);

        // Queue check
        try {
            $queueSize = Redis::llen('queues:default') + Redis::llen('queues:high') + Redis::llen('queues:critical');
            $checks['queue'] = 'ok';
            $checks['queue_depth'] = $queueSize;
        } catch (\Throwable $e) {
            $checks['queue'] = 'error';
            $status = 'degraded';
        }

        // S3/Storage check
        $start = microtime(true);
        try {
            Storage::disk('s3')->exists('health-check');
            $checks['storage'] = 'ok';
        } catch (\Throwable $e) {
            $checks['storage'] = 'error';
            $status = 'degraded';
        }
        $timings['storage_ms'] = round((microtime(true) - $start) * 1000, 2);

        // Failed jobs check
        try {
            $failedCount = DB::table('failed_jobs')->count();
            $checks['failed_jobs'] = $failedCount;
            if ($failedCount > 100) {
                $status = 'degraded';
            }
        } catch (\Throwable) {
            $checks['failed_jobs'] = 'unknown';
        }

        $httpStatus = $status === 'ok' ? 200 : 503;

        return response()->json([
            'status' => $status,
            'version' => config('app.version', '1.0.0'),
            'environment' => app()->environment(),
            'timestamp' => now()->toISOString(),
            'checks' => $checks,
            'timings' => $timings,
            'memory' => [
                'usage_mb' => round(memory_get_usage(true) / 1024 / 1024, 2),
                'peak_mb' => round(memory_get_peak_usage(true) / 1024 / 1024, 2),
            ],
        ], $httpStatus);
    }
}
