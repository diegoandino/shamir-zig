const std = @import("std");
const Managed = std.math.big.int.Managed;
const Mutable = std.math.big.int.Mutable;
const rand = std.crypto.random;

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    const stdout = std.io.getStdOut().writer();

    const p = try Managed.initSet(allocator, 31);
    const secret = try Managed.initSet(allocator, 10);

    try stdout.print("prime: {d}\n", .{p});
    try stdout.print("secret: {d}\n", .{secret});

    var SSSS = ShamirsSecretSharingScheme.init(allocator, 3, 5, p);
    defer SSSS.deinit();

    const shares = try SSSS.compute_shares(secret);
    defer allocator.free(shares);

    try stdout.print("shares:\n", .{});
    for (shares) |share| {
        try stdout.print("({d}, {any})\n", .{ share.x, share.y });
    }
}

const Share = struct {
    x: usize,
    y: Managed,
};

const ShamirsSecretSharingScheme = struct {
    allocator: std.mem.Allocator,
    threshold: usize,
    num_shares: usize,
    prime: Managed,

    pub fn init(allocator: std.mem.Allocator, threshold: usize, num_shares: usize, prime: Managed) ShamirsSecretSharingScheme {
        return ShamirsSecretSharingScheme{
            .allocator = allocator,
            .threshold = threshold,
            .num_shares = num_shares,
            .prime = prime,
        };
    }

    pub fn deinit(self: *ShamirsSecretSharingScheme) void {
        self.prime.deinit();
    }

    pub fn compute_shares(self: ShamirsSecretSharingScheme, secret: Managed) ![]Share {
        std.debug.assert(self.threshold < self.num_shares);

        const polynomial = try self.sample_random_polynomial(secret);
        defer self.allocator.free(polynomial);

        try printPolynomial(polynomial);

        var shares = try self.allocator.alloc(Share, self.num_shares);
        var i: usize = 0;
        while (i < shares.len) : (i += 1) {
            shares[i] = Share{
                .x = i + 1,
                .y = try self.evaluate_polynomial(polynomial, i + 1),
            };
        }
        return shares;
    }

    fn evaluate_polynomial(self: ShamirsSecretSharingScheme, polynomial: []Managed, x: usize) !Managed {
        var accum = try Managed.initSet(self.allocator, 0);
        var X = try Managed.initSet(self.allocator, x);
        var Q = try Managed.initSet(self.allocator, 0);
        defer X.deinit();
        defer Q.deinit();
        var i = polynomial.len;
        while (i > 0) : (i -= 1) {
            try Managed.mul(&accum, &accum, &X);
            try Managed.add(&accum, &accum, &polynomial[i - 1]);
            try Managed.divFloor(&Q, &accum, &accum, &self.prime);
        }
        return accum;
    }

    fn sample_random_polynomial(self: ShamirsSecretSharingScheme, secret: Managed) ![]Managed {
        const coeffs = try self.allocator.alloc(Managed, self.threshold);
        coeffs[0] = secret;
        var i: usize = 1;
        while (i < coeffs.len) : (i += 1) {
            coeffs[i] = try self.mod(try generateSecureRandomBigInt(self.allocator, 512), self.prime);
        }
        return coeffs;
    }

    fn mod(self: ShamirsSecretSharingScheme, a: Managed, b: Managed) !Managed {
        var q = try Managed.initSet(self.allocator, 0);
        var r = try Managed.initSet(self.allocator, 0);
        try Managed.divFloor(&q, &r, &a, &b);
        q.deinit();
        return r;
    }
};

fn printPolynomial(poly: []Managed) !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("polynomial:\n", .{});
    for (poly, 0..) |coeff, i| {
        try stdout.print(" + {any}*x^{d}", .{ coeff, i });
    }
    try stdout.print("\n", .{});
}

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

    // must be an integer number of bytes
    std.debug.assert(bits % 8 == 0);

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
