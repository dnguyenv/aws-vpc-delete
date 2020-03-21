#!/bin/sh
display_usage() { 
	printf "Usage: \n" 
	printf "docker run --rm -e AWS_SECRET_ACCESS_KEY=\"[YOUR AWS_SECRET_ACCESS_KEY]\" -e AWS_ACCESS_KEY_ID=\"[YOUR AWS_ACCESS_KEY_ID]\" -e AWS_REGION=\"[YOUR AWS_REGION]\" quay.io/dnguyenv/aws-vpc-cleanup:0.0.1 clean \"[YOUR AWS VPC ID]\"\n" 
} 

if [  $# -le 1 ] 
then 
		display_usage
		exit 1
fi

if [[ $1 != "clean" ]]; then 
    display_usage
    exit 1
fi 
/clean.sh $2