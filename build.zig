const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Create the library
    const lib = b.addStaticLibrary(.{
        .name = "shamir-zig",
        .root_source_file = b.path("src/ssss.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Create a module for the library
    const mod = b.addModule("shamir-zig", .{
        .root_source_file = b.path("src/ssss.zig"),
    });

    // Install the library artifact
    b.installArtifact(lib);

    // Create test executable
    const main_tests = b.addTest(.{
        .root_source_file = b.path("test/test.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Add the library module to the test executable
    main_tests.root_module.addImport("shamir-zig", mod);

    // Create a test step
    const test_step = b.step("test", "Run library tests");
    const run_main_tests = b.addRunArtifact(main_tests);
    test_step.dependOn(&run_main_tests.step);
}
