# Shamir-Zig
A Shamir's Secret Sharing Scheme library written in Zig.

## Notes
- Not to be used in Production `yet` (as it's a research project).
- Doesn't support full miller-rabin primality test (the prime selection is left up to the user)

## Get Started

### Basic Usage
```
const allocator = std.heap.c_allocator;

var secret = try Managed.init(allocator);
defer secret.deinit();
try secret.setString(10, "12345678901234567890");

var p = try Managed.init(allocator);
try p.setString(10, "2305843009213693951"); // 2^61 - 1 (Mersenne prime)

var ssss = ShamirsSecretSharingScheme.init(allocator, 3, 5, p);
defer ssss.deinit();

const shares = try ssss.compute_shares(secret);
defer allocator.free(shares);

const reconstructed = try ssss.reconstruct_secret(shares[0..3]);
defer reconstructed.deinit();
```
For more usage, see `test/` directory

### Basic Usage with httpz
See 'demo' branch
```
git checkout demo --> server/src/server.zig (contains full httpz server implementation)
```
