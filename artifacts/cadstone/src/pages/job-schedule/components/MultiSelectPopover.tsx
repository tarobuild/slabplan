import { Check, ChevronDown } from "lucide-react"
import { type ScheduleSettingsOption } from "@/lib/schedule"
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

export function MultiSelectPopover({
  placeholder,
  options,
  selected,
  onChange,
}: {
  placeholder: string
  options: ScheduleSettingsOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between border-[#E5E7EB] bg-white font-normal text-slate-700"
        >
          <span className="truncate">
            {selected.length > 0
              ? `${selected.length} selected`
              : placeholder}
          </span>
          <ChevronDown className="size-4 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}`} />
          <CommandList>
            <CommandEmpty>No matches found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option.id)

                return (
                  <CommandItem
                    key={option.id}
                    value={option.name}
                    onSelect={() => {
                      onChange(
                        isSelected
                          ? selected.filter((value) => value !== option.id)
                          : [...selected, option.id],
                      )
                    }}
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded border border-slate-300",
                        isSelected && "border-primary bg-primary text-white",
                      )}
                    >
                      {isSelected ? <Check className="size-3" /> : null}
                    </div>
                    <span className="truncate">{option.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
