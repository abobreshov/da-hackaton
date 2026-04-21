import { test, expect } from '../fixtures/test';

/**
 * M2 demo journey — room join + leave flow (EPIC-05 + EPIC-02).
 *
 * Seeded `user@example.com` navigates to seeded #general (`/rooms/1`),
 * confirms the
 * member list renders (so presence UI has something to hang off), then
 * leaves the room and asserts they disappear from the member list.
 *
 * Exercises:
 *   - AC-05 room membership read (member list renders)
 *   - AC-05 leave flow (self removal)
 *   - AC-02 presence indicator attached to each member row
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
// FE route is `/rooms/$roomId` where $roomId is a numeric integer (Number()'d
// at the route level — non-numerics yield INVALID_ROOM_ID). The demo seed
// (`backend/scripts/seed-demo.ts`) inserts rooms in order [general, random,
// demo] into a freshly-migrated `rooms` table, so #general lands on bigserial
// id 1. If the seed is reshuffled or run on top of pre-existing rooms, this
// constant must be updated to match.
const ROOM_ID = '1';

test.describe('M2 — room join / leave', () => {
  test('user opens seeded #general, sees member list, then leaves', async ({
    loginPage,
    dashboardPage,
    roomDetailPage,
  }) => {
    // --- Arrange: sign in.
    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.login(USER.email, USER.password);
    await dashboardPage.expectLoaded();

    // --- Act: navigate to the room detail view.
    await roomDetailPage.goto(ROOM_ID);
    await roomDetailPage.expectLoaded();

    // --- Assert 1: member list renders with the current user present.
    await expect(roomDetailPage.getMemberList()).toBeVisible();
    await roomDetailPage.expectMemberListed(USER.username);

    // --- Act: leave the room.
    await roomDetailPage.leaveRoom();

    // --- Assert 2: the user row is removed from the member list (or the
    // list re-renders without them once the BFF broadcast is processed).
    await roomDetailPage.expectMemberNotListed(USER.username);
  });
});
