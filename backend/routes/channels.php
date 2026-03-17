<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

Broadcast::channel('org.{orgId}', function ($user, $orgId) {
    return $user->organization_id === $orgId;
});
