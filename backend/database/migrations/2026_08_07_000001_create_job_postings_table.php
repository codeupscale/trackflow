<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('job_postings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('department_id')->constrained()->cascadeOnDelete();
            // A posting can outlive the position it was opened against, so the
            // position is a reference, not an owner: null it rather than delete
            // a live job ad.
            $table->foreignUuid('position_id')->nullable()->constrained()->nullOnDelete();

            $table->string('title', 255);
            $table->string('employment_type', 20);   // full_time, part_time, contract, intern
            $table->string('work_mode', 20);         // on_site, remote, hybrid
            $table->string('location', 255)->nullable();
            $table->date('posting_date')->nullable(); // cannot publish before this date
            $table->time('start_time')->nullable();   // office / working hours
            $table->time('end_time')->nullable();

            // Salary is a snapshot on the posting, NOT read live from the position:
            // changing a position's band must not silently rewrite a published ad.
            // Encrypted + hidden, matching Position. Consequence: cannot be sorted
            // or filtered in SQL.
            $table->text('min_salary')->nullable();
            $table->text('max_salary')->nullable();
            // Gates whether the range is exposed on the public careers feed.
            $table->boolean('send_salary_via_api')->default(false);

            $table->string('short_description', 500)->nullable();
            $table->boolean('is_published')->default(false);

            $table->timestamps();
            $table->softDeletes();

            $table->index(['organization_id', 'is_published']);
            $table->index(['organization_id', 'department_id']);
            $table->index(['organization_id', 'position_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_postings');
    }
};
