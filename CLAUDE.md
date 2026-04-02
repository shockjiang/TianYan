## goal: I want to build a website that on preview the files of given root directory recursively.
- It has a beautifly UI, which contain a thin top pannel, left pannel, and main (right) pannel
- top pannel allows user input a root directory
- left pannel list all directories and files under the root directory recursively with a tree-like UI structure
- main pannel visualize the contents of file or file tuple. The file can be RGB, depth(Uint16), mask(0/1), Json, text or others.file tuple is combination of files, e.g., RGB-Depth, RGB-Mask, RGB-Depth-Mask,etc. So the visualization type enumerated. The logic of visualizing individual file is easy and can be built-int support. Visualization of file tuple should follow different logics. So define a scalable way that allows me to add new types of file tuple. top pannel can choose the visualization type. 

## existing types of file tuple
- rgb + json (bbox + mask + affordance)
- rgb + mask
- rgb + depth
- rgb + mask + depth
