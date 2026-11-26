#import <Cocoa/Cocoa.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 1;
        NSImage *logo = [[NSImage alloc] initWithContentsOfFile:@(argv[1])];
        if (!logo) return 1;
        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL
            pixelsWide:1024 pixelsHigh:1024 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES
            isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
        NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
        [logo drawInRect:NSMakeRect(96,96,832,832) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1.0];
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        return [png writeToFile:@(argv[2]) atomically:YES] ? 0 : 1;
    }
}
