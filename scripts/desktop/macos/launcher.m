#import <Cocoa/Cocoa.h>

@interface TableLauncher : NSObject <NSApplicationDelegate>
@property(nonatomic) BOOL smoke;
@property(nonatomic) BOOL stopping;
@property(nonatomic) int result;
@property(nonatomic, strong) NSTask *server;
@property(nonatomic, strong) NSFileHandle *input;
@property(nonatomic, strong) NSURL *table;
@end

@implementation TableLauncher

static NSString *label(NSString *english, NSString *chinese) {
    return [NSLocale.preferredLanguages.firstObject hasPrefix:@"zh"] ? chinese : english;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    if (!self.smoke) {
        NSMenu *main = [NSMenu new];
        NSMenuItem *app = [main addItemWithTitle:@"" action:nil keyEquivalent:@""];
        NSMenu *menu = [NSMenu new];
        NSMenuItem *open = [menu addItemWithTitle:label(@"Open table", @"打开牌桌")
                                          action:@selector(openTable:) keyEquivalent:@"o"];
        open.target = self;
        [menu addItemWithTitle:label(@"Quit Holdem on the Clock", @"退出摸鱼德州")
                         action:@selector(terminate:) keyEquivalent:@"q"];
        app.submenu = menu;
        NSApp.mainMenu = main;
    }
    NSURL *runtime = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"runtime" isDirectory:YES];
    NSTask *task = [NSTask new];
    self.server = task;
    task.executableURL = [runtime URLByAppendingPathComponent:@"node"];
    task.arguments = @[[runtime URLByAppendingPathComponent:@"app/desktop.mjs"].path];
    task.currentDirectoryURL = runtime;
    NSPipe *input = [NSPipe pipe];
    self.input = input.fileHandleForWriting;
    task.standardInput = input;
    NSPipe *output = [NSPipe pipe];
    task.standardOutput = output;
    task.standardError = [NSFileHandle fileHandleWithStandardError];
    task.terminationHandler = ^(NSTask *finished) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (self.stopping) {
                [NSApp replyToApplicationShouldTerminate:YES];
                return;
            }
            [self fail:label(@"The local server stopped. Open the app again to start a new table.",
                             @"本机服务已停止。重新打开应用即可开桌。")];
        });
    };
    NSError *error;
    if (![task launchAndReturnError:&error]) {
        [self fail:error.localizedDescription];
        return;
    }
    // Parse complete lines even when the child splits the readiness message between writes.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        FILE *stream = fdopen(dup(output.fileHandleForReading.fileDescriptor), "r");
        if (!stream) return;
        char line[4096];
        while (fgets(line, sizeof(line), stream)) {
            NSString *message = [[NSString stringWithUTF8String:line]
                                 stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            if (![message hasPrefix:@"DESKTOP_READY "]) continue;
            NSURLComponents *parts = [NSURLComponents componentsWithString:[message substringFromIndex:@"DESKTOP_READY ".length]];
            if (![parts.scheme isEqualToString:@"http"] || ![parts.host isEqualToString:@"127.0.0.1"] ||
                !parts.port || parts.user || parts.password) continue;
            dispatch_async(dispatch_get_main_queue(), ^{ [self ready:parts.URL]; });
        }
        fclose(stream);
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (!self.table && !self.stopping) {
            [self fail:label(@"The table did not start in time. Quit the app and try again.",
                             @"牌桌启动超时，请退出后重新打开应用。")];
        }
    });
}

- (void)ready:(NSURL *)url {
    if (self.stopping || self.table) return;
    self.table = url;
    if (!self.smoke) {
        [self openTable:nil];
        return;
    }
    NSURL *address = [url URLByAppendingPathComponent:@"api/address"];
    [[NSURLSession.sharedSession dataTaskWithURL:address completionHandler:^(NSData *data, NSURLResponse *response, NSError *err) {
        id info = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        BOOL ok = !err && [info isKindOfClass:NSDictionary.class] && [info[@"kernelAvailable"] boolValue];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (ok) printf("MAC_APP_READY %s\n", url.absoluteString.UTF8String);
            else self.result = 1;
            [NSApp terminate:nil];
        });
    }] resume];
}

- (void)openTable:(id)sender {
    if (self.table && ![NSWorkspace.sharedWorkspace openURL:self.table]) {
        [self fail:[NSString stringWithFormat:label(@"Open %@ in your browser.", @"请在浏览器打开 %@。"), self.table.absoluteString]];
    }
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)visible {
    [self openTable:nil];
    return NO;
}

- (void)fail:(NSString *)message {
    if (self.stopping) return;
    self.result = 1;
    if (self.smoke) fprintf(stderr, "%s\n", message.UTF8String);
    else {
        [NSApp activateIgnoringOtherApps:YES];
        NSAlert *alert = [NSAlert new];
        alert.messageText = label(@"Could not open the table", @"无法打开牌桌");
        alert.informativeText = message;
        [alert runModal];
    }
    [NSApp terminate:nil];
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {
    if (self.stopping) return NSTerminateLater;
    self.stopping = YES;
    if (!self.server.running) return NSTerminateNow;
    [self.input closeFile];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (self.server.running) [self.server terminate];
    });
    return NSTerminateLater;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.smoke) exit(self.result);
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        TableLauncher *launcher = [TableLauncher new];
        launcher.smoke = [NSProcessInfo.processInfo.arguments containsObject:@"--verify-launch"];
        [app setActivationPolicy:launcher.smoke ? NSApplicationActivationPolicyProhibited : NSApplicationActivationPolicyRegular];
        app.delegate = launcher;
        [app run];
        return launcher.result;
    }
}
