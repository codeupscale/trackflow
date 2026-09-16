<?php

namespace App\Console\Commands;

use App\Models\Asset;
use App\Models\Organization;
use App\Models\User;
use App\Services\AssetService;
use Illuminate\Console\Command;

/**
 * Fill the asset register with a realistic catalogue, for testing hand-overs.
 *
 * Items are created through AssetService::create — the same path the Add item
 * dialog uses — so tags are allocated in sequence and every rule applies. They
 * are created UNASSIGNED on purpose: assigning is the thing being tested, so
 * the register starts ready for it.
 *
 * A few items are deliberately not available (in repair, retired, lost) so the
 * status filters, the "needs attention" count and the refusal to assign an item
 * in repair all have something real to show.
 *
 * Idempotent on serial number: re-running adds nothing already present, and it
 * never touches, reassigns or deletes existing items.
 *
 * Local and testing only.
 */
class SeedDemoAssets extends Command
{
    protected $signature = 'assets:seed-demo {--org= : Organization id. Defaults to the only one, or asks.}';

    protected $description = 'Add a realistic catalogue of company items to the asset register (local only).';

    public function handle(AssetService $assets): int
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->error('This command writes fixture data and only runs on local or testing.');

            return self::FAILURE;
        }

        $org = $this->option('org')
            ? Organization::withoutGlobalScopes()->find($this->option('org'))
            : Organization::withoutGlobalScopes()->orderBy('name')->first();

        if (! $org) {
            $this->error('No organization found.');

            return self::FAILURE;
        }

        // Created as an HR manager (or the owner), exactly as someone using the
        // screen would — so created_by is a real person, not null.
        $actor = User::withoutGlobalScopes()->where('organization_id', $org->id)->where('role', 'hr_manager')->first()
            ?? User::withoutGlobalScopes()->where('organization_id', $org->id)->where('role', 'owner')->first();

        if (! $actor) {
            $this->error('The organization needs an HR manager or owner to own the items.');

            return self::FAILURE;
        }

        auth()->setUser($actor);

        $added = 0;
        $skipped = 0;

        foreach ($this->catalogue() as $item) {
            $exists = Asset::withoutGlobalScopes()
                ->where('organization_id', $org->id)
                ->where('serial_number', $item['serial_number'])
                ->exists();

            if ($exists) {
                $skipped++;

                continue;
            }

            $assets->create($actor, $item);
            $added++;
        }

        $this->info("Added {$added} item(s) to {$org->name}" . ($skipped ? ", skipped {$skipped} already present." : '.'));
        $this->newLine();

        $this->table(
            ['Tag', 'Item', 'Category', 'Status', 'Warranty ends'],
            Asset::withoutGlobalScopes()
                ->where('organization_id', $org->id)
                ->orderBy('asset_tag')
                ->get()
                ->map(fn (Asset $a) => [$a->asset_tag, $a->name, $a->category, $a->status, $a->warranty_expires_on?->format('Y-m-d') ?? '—'])
                ->all(),
        );

        return self::SUCCESS;
    }

    /**
     * Dates are relative to today, so warranties stay meaningful whenever this
     * runs — two items always end within 30 days, to exercise "needs attention".
     */
    private function catalogue(): array
    {
        $ago = fn (int $months) => now()->subMonths($months)->toDateString();
        $in = fn (int $days) => now()->addDays($days)->toDateString();

        return [
            // Laptops
            ['name' => 'MacBook Pro 14"', 'category' => 'laptop', 'brand' => 'Apple', 'model' => 'M3 Pro, 18GB, 512GB', 'serial_number' => 'C02XK1ABMD6T', 'purchase_date' => $ago(8), 'purchase_cost' => 685000, 'warranty_expires_on' => $in(120), 'condition' => 'good'],
            ['name' => 'MacBook Air 13"', 'category' => 'laptop', 'brand' => 'Apple', 'model' => 'M2, 16GB, 256GB', 'serial_number' => 'FVFXC2ABQ6L4', 'purchase_date' => $ago(14), 'purchase_cost' => 385000, 'warranty_expires_on' => $in(18), 'condition' => 'good'],
            ['name' => 'ThinkPad T14', 'category' => 'laptop', 'brand' => 'Lenovo', 'model' => 'Gen 4, i7, 32GB', 'serial_number' => 'PF4K9WZ2', 'purchase_date' => $ago(3), 'purchase_cost' => 410000, 'warranty_expires_on' => $in(700), 'condition' => 'new'],
            ['name' => 'Dell Latitude 5440', 'category' => 'laptop', 'brand' => 'Dell', 'model' => 'i5, 16GB, 512GB', 'serial_number' => '8RKMT34', 'purchase_date' => $ago(20), 'purchase_cost' => 265000, 'warranty_expires_on' => $in(160), 'condition' => 'fair'],
            ['name' => 'HP EliteBook 840', 'category' => 'laptop', 'brand' => 'HP', 'model' => 'G10, i7, 16GB', 'serial_number' => '5CG3281XQZ', 'purchase_date' => $ago(26), 'purchase_cost' => 298000, 'warranty_expires_on' => $in(-40), 'condition' => 'damaged', 'status' => 'in_repair', 'notes' => 'Keyboard not responding. Sent to HP service centre.'],

            // Desktops & monitors
            ['name' => 'Mac mini', 'category' => 'desktop', 'brand' => 'Apple', 'model' => 'M2, 16GB', 'serial_number' => 'H7WQ21LJ4P', 'purchase_date' => $ago(10), 'purchase_cost' => 215000, 'warranty_expires_on' => $in(60), 'condition' => 'good'],
            ['name' => 'Dell OptiPlex 7010', 'category' => 'desktop', 'brand' => 'Dell', 'model' => 'i7, 32GB, 1TB', 'serial_number' => 'JX9TR64', 'purchase_date' => $ago(4), 'purchase_cost' => 240000, 'warranty_expires_on' => $in(650), 'condition' => 'new'],
            ['name' => 'Dell UltraSharp 27"', 'category' => 'monitor', 'brand' => 'Dell', 'model' => 'U2723QE 4K', 'serial_number' => 'CN0TJ8G2', 'purchase_date' => $ago(6), 'purchase_cost' => 145000, 'warranty_expires_on' => $in(900), 'condition' => 'good'],
            ['name' => 'LG 24" Monitor', 'category' => 'monitor', 'brand' => 'LG', 'model' => '24MP60G IPS', 'serial_number' => '308NDKF4A112', 'purchase_date' => $ago(18), 'purchase_cost' => 42000, 'warranty_expires_on' => $in(25), 'condition' => 'good'],

            // Phones & tablets
            ['name' => 'iPhone 15', 'category' => 'phone', 'brand' => 'Apple', 'model' => '128GB, Black', 'serial_number' => 'F4GZK1P3N7', 'purchase_date' => $ago(5), 'purchase_cost' => 295000, 'warranty_expires_on' => $in(210), 'condition' => 'new'],
            ['name' => 'Samsung Galaxy A55', 'category' => 'phone', 'brand' => 'Samsung', 'model' => '256GB', 'serial_number' => 'R58W21ABC7M', 'purchase_date' => $ago(9), 'purchase_cost' => 125000, 'warranty_expires_on' => $in(95), 'condition' => 'good'],
            ['name' => 'iPad Air', 'category' => 'tablet', 'brand' => 'Apple', 'model' => 'M2, 11", Wi-Fi', 'serial_number' => 'DMPXK7Q9L2', 'purchase_date' => $ago(7), 'purchase_cost' => 225000, 'warranty_expires_on' => $in(150), 'condition' => 'good'],

            // Connectivity & access
            ['name' => 'Jazz Business SIM', 'category' => 'sim_card', 'brand' => 'Jazz', 'model' => 'Corporate 50GB plan', 'serial_number' => '8992302100045178', 'purchase_date' => $ago(2), 'purchase_cost' => 1500, 'condition' => 'new'],
            ['name' => 'Zong Data SIM', 'category' => 'sim_card', 'brand' => 'Zong', 'model' => '4G unlimited', 'serial_number' => '8992300700182236', 'purchase_date' => $ago(11), 'purchase_cost' => 1200, 'condition' => 'good'],
            ['name' => 'Office Access Card', 'category' => 'id_card', 'brand' => 'HID', 'model' => 'iCLASS SE', 'serial_number' => 'HID-0044721', 'purchase_date' => $ago(1), 'purchase_cost' => 3500, 'condition' => 'new'],
            ['name' => 'Office Access Card', 'category' => 'id_card', 'brand' => 'HID', 'model' => 'iCLASS SE', 'serial_number' => 'HID-0044722', 'purchase_date' => $ago(1), 'purchase_cost' => 3500, 'condition' => 'new'],

            // Accessories & furniture
            ['name' => 'Logitech MX Master 3S', 'category' => 'accessory', 'brand' => 'Logitech', 'model' => 'Wireless mouse', 'serial_number' => '2231LZ0A8KD8', 'purchase_date' => $ago(6), 'purchase_cost' => 32000, 'condition' => 'good'],
            ['name' => 'Anker USB-C Docking Station', 'category' => 'accessory', 'brand' => 'Anker', 'model' => '13-in-1', 'serial_number' => 'AK8392QX7710', 'purchase_date' => $ago(12), 'purchase_cost' => 48000, 'condition' => 'poor', 'status' => 'lost', 'notes' => 'Not returned after the Karachi office move.'],
            ['name' => 'Ergonomic Office Chair', 'category' => 'furniture', 'brand' => 'Interwood', 'model' => 'Mesh, lumbar support', 'serial_number' => 'IW-CH-20117', 'purchase_date' => $ago(15), 'purchase_cost' => 65000, 'condition' => 'good'],
            ['name' => 'Standing Desk', 'category' => 'furniture', 'brand' => 'Flexispot', 'model' => 'E7, 160cm', 'serial_number' => 'FX-E7-88341', 'purchase_date' => $ago(30), 'purchase_cost' => 155000, 'condition' => 'fair', 'status' => 'retired', 'notes' => 'Motor failed. Replaced; kept for spare parts.'],

            // Software
            ['name' => 'JetBrains All Products Pack', 'category' => 'software_license', 'brand' => 'JetBrains', 'model' => 'Annual, 1 seat', 'serial_number' => 'JB-LIC-7F2K9Q', 'purchase_date' => $ago(4), 'purchase_cost' => 190000, 'warranty_expires_on' => $in(240), 'condition' => 'new'],
            ['name' => 'Adobe Creative Cloud', 'category' => 'software_license', 'brand' => 'Adobe', 'model' => 'All Apps, annual', 'serial_number' => 'ADB-CC-44X1M', 'purchase_date' => $ago(10), 'purchase_cost' => 175000, 'warranty_expires_on' => $in(55), 'condition' => 'good'],

            // Other
            ['name' => 'Portable Projector', 'category' => 'other', 'brand' => 'Epson', 'model' => 'EF-12', 'serial_number' => 'X8NH2300471', 'purchase_date' => $ago(22), 'purchase_cost' => 210000, 'warranty_expires_on' => $in(-10), 'condition' => 'good'],
        ];
    }
}
