import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface NotificationsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationsDialog({ open, onClose }: NotificationsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Notifications</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          Nothing here yet
        </div>
      </DialogContent>
    </Dialog>
  );
} 