const std = @import("std");
const Managed = std.math.big.int.Managed;
const rand = std.crypto.random;
const stdout = std.io.getStdOut().writer();
const shamir_zig = @import("shamir-zig");
const ShamirsSecretSharingScheme = shamir_zig.ShamirsSecretSharingScheme;

/// Generates a cryptographically secure random BigInt of specified bit length
fn generateSecureRandomBigInt(allocator: std.mem.Allocator, bits: usize) !std.math.big.int.Managed {
    var result = try std.math.big.int.Managed.init(allocator);
    errdefer result.deinit();

    // Calculate how many bytes we need
    const bytes_needed = (bits + 7) / 8;
    
    // Create a buffer for our random bytes
    const random_bytes = try allocator.alloc(u8, bytes_needed);
    defer allocator.free(random_bytes);
    
    // Fill with crypto secure random data
    std.crypto.random.bytes(random_bytes);
    
    // If bits isn't a multiple of 8, mask the extra bits in the first byte
    if (bits % 8 != 0) {
        std.debug.print("error mult 8", .{});        
    }
    
    // Convert bytes to BigInt
    const hex_str = try std.fmt.allocPrint(
        allocator,
        "{s}",
        .{std.fmt.fmtSliceHexUpper(random_bytes)},
    );
    defer allocator.free(hex_str);
    
    try result.setString(16, hex_str);
    
    return result;
}

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    var secret = try Managed.init(allocator);
    defer secret.deinit();

    try secret.setString(10, "965362171271163594829743597482564660996437523167191222700987408470500128126609480027797509581266397721138520078334647253520455741370857905969136022897819664");
    const p = try Managed.initSet(allocator, 183098854021111014847049736753592024736470361678118789554475301745631375088715378516210127567721475050701458356229595682612785871218119030132494038812323674675191754254520929902435652804246223835744924311359135557055284166986509276141863517277803082748254617919368292882064785309132857263185347484302086739292988500047169223654972608638044813088228827991887702654217888042042623629474506427931229425050435230703091930962777260574838696196764199813120000000000000000000000000000000000000000000000000000000000000000000701);

    try stdout.print("Prime: {any}\n", .{p});

    var SSSS = ShamirsSecretSharingScheme.init(allocator, 10, 10, p);
    defer SSSS.deinit();

    const shares = try SSSS.compute_shares(secret);
    defer allocator.free(shares);

    try stdout.print("shares:\n", .{});
    for (shares) |share| {
        try stdout.print("({d}, {any})\n", .{ share.x, share.y });
    }

    // Take any threshold number of shares
    const reconstruction_shares = shares[0..SSSS.threshold];

    // Reconstruct the secret
    const reconstructed_secret = try SSSS.reconstruct_secret(reconstruction_shares);
    defer reconstructed_secret.deinit();

    try stdout.print("\nReconstructed secret: {d}\n", .{reconstructed_secret});

    // Verify reconstruction
    try stdout.print("Original secret: {d}\n", .{secret});
}

test "basic SSSS functionality" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var secret = try Managed.init(allocator);
    defer secret.deinit();
    try secret.setString(10, "12345678901234567890");

    var p = try Managed.init(allocator);
    try p.setString(10, "2305843009213693951"); // 2^61 - 1 (Mersenne prime)

    var ssss = ShamirsSecretSharingScheme.init(allocator, 3, 5, p);
    defer ssss.deinit();
    // Note: don't deinit p here as SSSS takes ownership

    const shares = try ssss.compute_shares(secret);
    defer allocator.free(shares);

    const reconstructed = try ssss.reconstruct_secret(shares[0..3]);
    defer reconstructed.deinit();
    try testing.expect(reconstructed.order(secret) == .eq);
}

test "edge cases and validation" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var p = try Managed.init(allocator);
    try p.setString(10, "2305843009213693951");

    {
        var secret = try Managed.init(allocator);
        defer secret.deinit();
        try secret.setString(10, "12345");

        var ssss = ShamirsSecretSharingScheme.init(allocator, 4, 4, p);
        defer ssss.deinit();
        // p is owned by ssss now

        const shares = try ssss.compute_shares(secret);
        defer allocator.free(shares);

        const reconstructed = try ssss.reconstruct_secret(shares);
        defer reconstructed.deinit();
        try testing.expect(reconstructed.order(secret) == .eq);
    }
}

test "reconstruction with different share combinations" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var secret = try Managed.init(allocator);
    defer secret.deinit();
    try secret.setString(10, "987654321");

    var p = try Managed.init(allocator);
    try p.setString(10, "2305843009213693951");

    var ssss = ShamirsSecretSharingScheme.init(allocator, 3, 5, p);
    defer ssss.deinit();
    // p is owned by ssss

    const shares = try ssss.compute_shares(secret);
    defer allocator.free(shares);

    const combinations = [_][]const usize{
        &[_]usize{ 0, 1, 2 },
        &[_]usize{ 1, 2, 3 },
        &[_]usize{ 2, 3, 4 },
        &[_]usize{ 0, 2, 4 },
    };

    for (combinations) |combo| {
        var selected_shares = try allocator.alloc(@TypeOf(shares[0]), 3);
        defer allocator.free(selected_shares);

        for (combo, 0..) |idx, i| {
            selected_shares[i] = shares[idx];
        }

        const reconstructed = try ssss.reconstruct_secret(selected_shares);
        defer reconstructed.deinit();
        try testing.expect(reconstructed.order(secret) == .eq);
    }
}

test "large numbers" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var secret = try Managed.init(allocator);
    defer secret.deinit();
    try secret.setString(10, "123456789012345678901234567890123456789012345678901234567890");

    var p = try Managed.init(allocator);
    try p.setString(16, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFD");

    var ssss = ShamirsSecretSharingScheme.init(allocator, 5, 8, p);
    defer ssss.deinit();
    // p is owned by ssss

    const shares = try ssss.compute_shares(secret);
    defer allocator.free(shares);

    const reconstructed = try ssss.reconstruct_secret(shares[0..5]);
    defer reconstructed.deinit();
    try testing.expect(reconstructed.order(secret) == .eq);
}
