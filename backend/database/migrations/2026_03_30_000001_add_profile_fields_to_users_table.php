<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('job_title')->nullable()->after('avatar_url');
            $table->string('phone', 30)->nullable()->after('job_title');
            $table->string('linkedin_url', 500)->nullable()->after('phone');
            $table->string('github_url', 500)->nullable()->after('linkedin_url');
            $table->date('date_of_birth')->nullable()->after('github_url');
            $table->date('date_of_joining')->nullable()->after('date_of_birth');
            $table->string('bio', 500)->nullable()->after('date_of_joining');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'job_title',
                'phone',
                'linkedin_url',
                'github_url',
                'date_of_birth',
                'date_of_joining',
                'bio',
            ]);
        });
    }
};
