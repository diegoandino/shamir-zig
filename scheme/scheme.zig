const std = @import("std");
const Managed = std.math.big.int.Managed;
// const Mutable = std.math.big.int.Mutable;
const rand = std.crypto.random;
const stdout = std.io.getStdOut().writer();

pub fn main() !void {
    const allocator = std.heap.c_allocator;

    var secret = try Managed.init(allocator);
    defer secret.deinit();

    try secret.setString(10, "965362171271163594829743597482564660996437523167191222700987408470500128126609480027797509581266397721138520078334647253520455741370857905969136022897819664");

    const p = try choosePrime(allocator, secret, 5);
    // defer p.deinit();

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

pub const Share = struct {
    x: usize,
    y: Managed,
};

pub const ShamirsSecretSharingScheme = struct {
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
        std.debug.assert(self.threshold <= self.num_shares);

        const polynomial = try self.sample_random_polynomial(secret);
        defer self.allocator.free(polynomial);

        //try printPolynomial(polynomial);

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
            coeffs[i] = try self.sample_finite_field();
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

    fn sample_finite_field(self: ShamirsSecretSharingScheme) !Managed {
        var r = try generateSecureRandomBigInt(self.allocator, self.prime.bitCountAbs());
        while (Managed.order(r, self.prime) != std.math.Order.lt) {
            r.deinit();
            r = try generateSecureRandomBigInt(self.allocator, self.prime.bitCountAbs());
        }
        return r;
    }

    pub fn reconstruct_secret(self: ShamirsSecretSharingScheme, shares: []const Share) !*Managed {
        // Verify we have enough shares
        if (shares.len < self.threshold) {
            return error.NotEnoughShares;
        }

        // Initialize result
        var result = try self.allocator.create(Managed);
        errdefer self.allocator.destroy(result);
        result.* = try Managed.initSet(self.allocator, 0);
        errdefer result.deinit();

        for (shares[0..self.threshold], 0..) |share_i, i| {
            // Calculate lagrange basis poly
            var basis = try Managed.initSet(self.allocator, 1);
            defer basis.deinit();

            for (shares[0..self.threshold], 0..) |share_j, j| {
                if (i == j) continue;

                var numerator = try Managed.initSet(self.allocator, 0);
                defer numerator.deinit();

                var x_j = try Managed.initSet(self.allocator, share_j.x);
                defer x_j.deinit();
                try Managed.sub(&numerator, &numerator, &x_j);

                var denominator = try Managed.initSet(self.allocator, share_i.x);
                defer denominator.deinit();
                var x_i = try Managed.initSet(self.allocator, share_j.x);
                defer x_i.deinit();
                try Managed.sub(&denominator, &denominator, &x_i);

                var inv_denominator = try self.mod_inverse(denominator);
                defer inv_denominator.deinit();

                try Managed.mul(&basis, &basis, &numerator);
                try Managed.mul(&basis, &basis, &inv_denominator);

                const mod_result = try self.mod(basis, self.prime);
                basis.deinit();
                basis = mod_result;
            }

            var term = try Managed.initSet(self.allocator, 0);
            defer term.deinit();
            try Managed.mul(&term, &basis, &share_i.y);
            try Managed.add(result, result, &term);

            const mod_result = try self.mod(result.*, self.prime);
            result.deinit();
            result.* = mod_result;
        }

        return result;
    }

    fn mod_inverse(self: ShamirsSecretSharingScheme, num: Managed) !Managed {
        var num1 = try num.clone();
        if (!num.isPositive()) {
            try Managed.add(&num1, &num1, &self.prime);
        }

        const result = try self.extend_euclid_algo(num1);
        return result.inv;
    }

    const ExtendedEuclidResult = struct {
        gcd: Managed,
        s: Managed,
        inv: Managed,
    };

    fn extend_euclid_algo(self: ShamirsSecretSharingScheme, num: Managed) !ExtendedEuclidResult {
        var r = try self.prime.clone();
        var next_r = try num.clone();
        var s = try Managed.initSet(self.allocator, 1);
        var next_s = try Managed.initSet(self.allocator, 0);
        var t = try Managed.initSet(self.allocator, 0);
        var next_t = try Managed.initSet(self.allocator, 1);

        while (!next_r.eqlZero()) {
            var quotient = try Managed.initSet(self.allocator, 0);
            var remainder = try Managed.initSet(self.allocator, 0);
            try Managed.divFloor(&quotient, &remainder, &r, &next_r);

            const tmp_r = try next_r.clone();
            next_r.deinit();
            next_r = remainder;
            r.deinit();
            r = tmp_r;

            const tmp_s = try next_s.clone();
            var quotient_mul_next_s = try Managed.initSet(self.allocator, 0);
            try Managed.mul(&quotient_mul_next_s, &quotient, &next_s);
            try Managed.sub(&next_s, &s, &quotient_mul_next_s);
            s.deinit();
            s = tmp_s;
            quotient_mul_next_s.deinit();

            const tmp_t = try next_t.clone();
            var quotient_mul_next_t = try Managed.initSet(self.allocator, 0);
            try Managed.mul(&quotient_mul_next_t, &quotient, &next_t);
            try Managed.sub(&next_t, &t, &quotient_mul_next_t);
            t.deinit();
            t = tmp_t;
            quotient_mul_next_t.deinit();

            quotient.deinit();
        }

        // If r > 1, then a and m are not coprime and modular inverse does not exist
        var one = try Managed.initSet(self.allocator, 1);
        defer one.deinit();
        if (Managed.order(r, one) != .eq) {
            return error.NoModularInverse;
        }

        // Make t positive and ensure it's less than prime
        while (!t.isPositive()) {
            try Managed.add(&t, &t, &self.prime);
        }

        while (Managed.order(t, self.prime) != .lt) {
            try Managed.sub(&t, &t, &self.prime);
        }

        return ExtendedEuclidResult{
            .gcd = r,
            .s = s,
            .inv = t,
        };
    }
};

fn printPolynomial(poly: []Managed) !void {
    try stdout.print("polynomial:\n", .{});
    for (poly, 0..) |coeff, i| {
        try stdout.print(" + {any}*x^{d}", .{ coeff, i });
    }
    try stdout.print("\n", .{});
}

fn choosePrime(allocator: std.mem.Allocator, secret: Managed, bits: u5) !Managed {
    var max = try Managed.init(allocator);
    defer max.deinit();
    const one: u32 = 1;
    const shiftAmount: u32 = one << bits;
    try Managed.mul(&max, &secret, &try Managed.initSet(allocator, shiftAmount));

    while (true) {
        var p = try sampleSecureBigIntInRange(allocator, secret, max);

        if (try isProbablyPrime(allocator, p)) {
            return p;
        }
        p.deinit();
    }
}

fn sampleSecureBigIntInRange(allocator: std.mem.Allocator, start: Managed, end: Managed) !Managed {
    std.debug.assert(Managed.order(end, start) == std.math.Order.gt);

    var diff = try Managed.init(allocator);
    defer diff.deinit();
    try Managed.sub(&diff, &end, &start);

    var result = try Managed.init(allocator);
    var sampled = try Managed.init(allocator);
    while (true) {
        sampled.deinit();
        sampled = try generateSecureRandomBigInt(allocator, diff.bitCountAbs());
        try Managed.add(&result, &start, &sampled);
        if (Managed.order(result, end) == std.math.Order.lt) {
            sampled.deinit();
            break;
        }
    }
    return result;
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

    const extraBits: u3 = @intCast(bits % 8);
    if (extraBits != 0) {
        const one: u8 = 1;
        const bitMask = ((one << extraBits) - 1);
        random_bytes[0] &= bitMask;
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

/// Finds the smallest prime number larger than the input secret
pub fn findNextPrime(allocator: std.mem.Allocator, secret: Managed) !Managed {
    // Initialize the numbers we'll need
    var candidate = try secret.clone();
    errdefer candidate.deinit();

    var one = try Managed.initSet(allocator, 1);
    defer one.deinit();

    var two = try Managed.initSet(allocator, 2);
    defer two.deinit();

    // Add 1 to start checking from next number
    try Managed.add(&candidate, &candidate, &one);

    // Make odd if even
    if (!candidate.isOdd()) {
        try Managed.add(&candidate, &candidate, &one);
    }

    // Keep checking odd numbers until we find a prime
    while (true) {
        if (try isProbablyPrime(allocator, candidate)) {
            return candidate;
        }
        try Managed.add(&candidate, &candidate, &two);
    }
}

fn isProbablyPrime(allocator: std.mem.Allocator, n: Managed) !bool {
    // Handle small numbers using u64
    if (n.bitCountAbs() <= 64) {
        const small_n = try n.to(u64);
        if (small_n <= 1) return false;
        if (small_n == 2 or small_n == 3) return true;
        if (small_n % 2 == 0) return false;

        // Trial division for small numbers
        var i: u64 = 3;
        while (i * i <= small_n) : (i += 2) {
            if (small_n % i == 0) return false;
        }
        return true;
    }

    // For larger numbers, do trial division up to a small limit
    const trial_limit: u64 = 1000;
    var i: u64 = 3;

    var zero = try Managed.initSet(allocator, 0);
    defer zero.deinit();

    while (i < trial_limit) : (i += 2) {
        var divisor = try Managed.initSet(allocator, i);
        defer divisor.deinit();

        var quotient = try Managed.init(allocator);
        defer quotient.deinit();
        var remainder = try Managed.init(allocator);
        defer remainder.deinit();

        try Managed.divFloor(&quotient, &remainder, &n, &divisor);

        if (remainder.eql(zero)) {
            return false;
        }
    }

    return true;
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
