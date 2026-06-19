/**
 * Mirrors projects TTL cache logic in src/main/index.js (idle reassign dropdown).
 */

const PROJECTS_CACHE_TTL_MS = 30 * 60 * 1000;

function isProjectsCacheFresh(fetchedAt, now = Date.now()) {
    return fetchedAt > 0 && now - fetchedAt < PROJECTS_CACHE_TTL_MS;
}

function applyProjectsFetchResult(
    cached,
    fetchedAt,
    apiResult,
    now = Date.now(),
) {
    let next = cached;
    let nextFetchedAt = fetchedAt;
    if (Array.isArray(apiResult)) {
        next = apiResult;
        nextFetchedAt = now;
    }
    return { cachedProjects: next, fetchedAt: nextFetchedAt };
}

function applyProjectsFetchFailure(cached, fetchedAt) {
    return { cachedProjects: cached, fetchedAt };
}

describe("projects cache (idle reassign)", () => {
    const t0 = 1_700_000_000_000;

    test("cache is fresh within 30 minutes", () => {
        expect(isProjectsCacheFresh(t0, t0 + 5 * 60 * 1000)).toBe(true);
    });

    test("cache is stale after 30 minutes", () => {
        expect(isProjectsCacheFresh(t0, t0 + PROJECTS_CACHE_TTL_MS)).toBe(
            false,
        );
    });

    test("successful fetch updates cache", () => {
        const result = applyProjectsFetchResult(
            [],
            0,
            [{ id: "p1", name: "A" }],
            t0,
        );
        expect(result.cachedProjects).toHaveLength(1);
        expect(result.fetchedAt).toBe(t0);
    });

    test("failed fetch keeps previous cache", () => {
        const prev = [{ id: "p1", name: "A" }];
        const result = applyProjectsFetchFailure(prev, t0);
        expect(result.cachedProjects).toEqual(prev);
        expect(result.fetchedAt).toBe(t0);
    });
});
