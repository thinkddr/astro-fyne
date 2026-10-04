module github.com/thinkddr/astro-fyne/demo

go 1.27.1

require (
	fyne.io/fyne/v2 v2.8.1
	github.com/thinkddr/astro-fyne/native v0.0.0
)

replace github.com/thinkddr/astro-fyne/native => ../..
