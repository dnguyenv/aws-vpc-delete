#!/bin/sh
x=1
while [ $x -le 4 ]
do
    node /main.js delete $1
    x=$(($x+1))
    printf "Hang tight ... still working on it ...\n"
done