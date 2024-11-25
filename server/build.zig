const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.host;
    const optimize = b.standardOptimizeOption(.{});
    const exe = b.addExecutable(.{
        .name = "server",
        .root_source_file = b.path("./src/server.zig"),
        .target = target,
        .optimize = optimize,
    });

    const httpz = b.dependency("httpz", .{
        .target = target,
        .optimize = optimize,
    });

    exe.root_module.addImport("httpz", httpz.module("httpz"));

    // b.createModule(.{ .root_source_file = b.path("../scheme/scheme.zig") });
    // const src_module = b.createModule(.{
    //     .root_source_file = .{ .src_path = "../scheme/scheme.zig" },
    // });
    // b.addModule("scheme", src_module);
    const mod = b.addModule("scheme", .{ .root_source_file = b.path("../scheme/scheme.zig") });
    exe.root_module.addImport("scheme", mod);
    // const scheme_path = b.path("../../scheme/scheme.zig");
    // exe.root_module.addModule("scheme", scheme_path);
    // exe.root_module.add

    b.installArtifact(exe);
}
