<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Asset management: the company's physical and licensed property, and who has it.
 *
 * Two tables, split along the one line that matters:
 *
 *  - assets — the ITEM and its current state. current_holder_id is a
 *    denormalised pointer to the open assignment, kept so the list screen can
 *    filter "who has what" without a join per row.
 *
 *  - asset_assignments — the HISTORY. One row per hand-over, closed by setting
 *    returned_at. Rows are never overwritten, which is the whole value of the
 *    feature: "who had this laptop in March, and in what condition did they
 *    return it" has to stay answerable after the laptop has been reassigned
 *    three times.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();

            // Human-facing identifier printed on the sticker, e.g. AST-0042.
            $table->string('asset_tag', 32);
            $table->string('name');
            $table->string('category', 32);
            $table->string('brand')->nullable();
            $table->string('model')->nullable();
            $table->string('serial_number')->nullable();

            $table->date('purchase_date')->nullable();
            $table->decimal('purchase_cost', 14, 2)->nullable();
            $table->date('warranty_expires_on')->nullable();

            $table->string('status', 16)->default('available');
            $table->string('condition', 16)->default('good');

            $table->foreignUuid('current_holder_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->unique(['organization_id', 'asset_tag'], 'uq_assets_org_tag');
            $table->index(['organization_id', 'status'], 'idx_assets_org_status');
            $table->index(['organization_id', 'category'], 'idx_assets_org_category');
            $table->index(['organization_id', 'current_holder_id'], 'idx_assets_org_holder');
        });

        // A serial number identifies one physical device, so it is unique within
        // an org — but only when present (accessories often have none) and only
        // among live rows, so a retired-then-deleted record does not block the
        // replacement unit from being entered. Blueprint cannot express partial
        // indexes.
        DB::statement(
            'CREATE UNIQUE INDEX uq_assets_org_serial ON assets (organization_id, serial_number) '
            . 'WHERE serial_number IS NOT NULL AND deleted_at IS NULL'
        );

        Schema::create('asset_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('asset_id')->constrained('assets')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            $table->foreignUuid('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('assigned_at');
            $table->string('condition_on_assign', 16);
            $table->date('expected_return_on')->nullable();

            $table->timestamp('returned_at')->nullable();
            $table->foreignUuid('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('condition_on_return', 16)->nullable();

            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['asset_id', 'assigned_at'], 'idx_asset_assignments_asset_time');
            $table->index(['organization_id', 'user_id'], 'idx_asset_assignments_org_user');
        });

        // The invariant the whole module rests on: an item is with ONE person at
        // a time. Enforced by the database rather than only by the service, so
        // two HR managers assigning the same laptop in the same second cannot
        // both succeed.
        DB::statement(
            'CREATE UNIQUE INDEX uq_asset_assignments_one_open ON asset_assignments (asset_id) '
            . 'WHERE returned_at IS NULL'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('asset_assignments');
        Schema::dropIfExists('assets');
    }
};
