const std = @import("std");

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
    // Setup allocator
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();
    
    const stdout = std.io.getStdOut().writer();
    
    // Demonstrate generating multiple random numbers of the same size
    try stdout.writeAll("\nGenerating multiple 256-bit random numbers:\n\n");
    
    var i: usize = 0;
    while (i < 1000) : (i += 1) {
        var random_big = try generateSecureRandomBigInt(allocator, 256);
        defer random_big.deinit();
        try stdout.print("Random {d}: {any}\n", .{ i + 1, random_big });
    }
}

test "verify random bigint properties" {
    const testing = std.testing;
    const allocator = testing.allocator;
    
    // Test different bit sizes
    const test_sizes = [_]usize{ 64, 128, 256 };
    
    for (test_sizes) |bits| {
        // Generate random number
        var random_big = try generateSecureRandomBigInt(allocator, bits);
        defer random_big.deinit();
        
        // Verify bit length
        const actual_bits = try random_big.bitCountAbs();
        try testing.expect(actual_bits <= bits);
        
        // For sizes that are multiples of 8, we expect the bit length to be close to the requested size
        if (bits % 8 == 0) {
            const min_expected_bits = bits - 8; // Allow for leading zeros
            try testing.expect(actual_bits >= min_expected_bits);
        }
    }
}
