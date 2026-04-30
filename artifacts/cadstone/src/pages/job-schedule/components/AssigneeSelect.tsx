import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { AppUser } from "../types"

export function AssigneeSelect({
  users,
  value,
  onChange,
}: {
  users: AppUser[]
  value: string
  onChange: (value: string) => void
}) {
  const selectedUser = users.find((user) => user.id === value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between border-[#E5E7EB] bg-white font-normal text-slate-700"
        >
          <span className="truncate">{selectedUser?.fullName || "All team members"}</span>
          <ChevronDown className="size-4 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Search team members" />
          <CommandList>
            <CommandEmpty>No team members found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="All team members" onSelect={() => onChange("")}>
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded border border-slate-300",
                    value === "" && "border-orange-600 bg-orange-600 text-white",
                  )}
                >
                  {value === "" ? <Check className="size-3" /> : null}
                </div>
                All team members
              </CommandItem>
              <CommandItem value="Unassigned" onSelect={() => onChange("__unassigned__")}>
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded border border-slate-300",
                    value === "__unassigned__" && "border-orange-600 bg-orange-600 text-white",
                  )}
                >
                  {value === "__unassigned__" ? <Check className="size-3" /> : null}
                </div>
                Unassigned
              </CommandItem>
              {users.map((user) => (
                <CommandItem key={user.id} value={user.fullName} onSelect={() => onChange(user.id)}>
                  <div
                    className={cn(
                      "flex size-4 items-center justify-center rounded border border-slate-300",
                      value === user.id && "border-orange-600 bg-orange-600 text-white",
                    )}
                  >
                    {value === user.id ? <Check className="size-3" /> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate">{user.fullName}</p>
                    <p className="text-xs text-slate-400">{user.role.replaceAll("_", " ")}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
